import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
	and,
	eq,
	sql,
	integration,
	request,
	requestLinearIssue,
	linearWebhook,
} from '@repo/db';
import { admin, identity, type Env } from '../context.js';
import { encrypt } from '../slack.js';
import {
	linearCredentials,
	linearOrganizationInput,
	linearQuery,
	readLinearIssue,
} from '../linear.js';
import { findRequest } from '../services/requests.js';
import { recordEvent } from '../services/request-events.js';
import { applyLinearStatus, lockLinear } from '../services/linear-sync.js';

export const linearRoutes = new Hono<Env>();
linearRoutes.post('/manage/integrations/linear', async (c) => {
	admin(c);
	const { apiKey } = z
		.object({ apiKey: z.string().trim().min(1).max(1000) })
		.parse(await c.req.json());
	const data = await linearQuery<{ organization: unknown }>(
		apiKey,
		'{ organization { id name urlKey } }'
	);
	const org = linearOrganizationInput.parse(data.organization);
	await c.get('db').transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${c.get('organizationId') + ':linear-connect'}, 0))`
		);
		const [old] = await tx
			.select()
			.from(integration)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'linear')
				)
			);
		if (old) {
			await lockLinear(tx, old.id);
			if (old.externalAccountId !== org.id) {
				const links = await tx
					.select()
					.from(requestLinearIssue)
					.where(eq(requestLinearIssue.integrationId, old.id));
				for (const link of links) {
					const [row] = await tx
						.select()
						.from(request)
						.where(eq(request.id, link.requestId))
						.for('update');
					if (row)
						await recordEvent(
							tx,
							row,
							{ actorId: identity(c).userId, source: 'team' },
							'linear_unlinked',
							{ linearUrl: { before: link.url, after: null } }
						);
				}
				await tx
					.delete(requestLinearIssue)
					.where(eq(requestLinearIssue.integrationId, old.id));
			}
			// Events received before reconnecting must not cross workspace/credential boundaries.
			await tx
				.delete(linearWebhook)
				.where(eq(linearWebhook.integrationId, old.id));
		}
		const secret =
			old?.externalAccountId === org.id &&
			!old.disconnectedAt &&
			old.encryptedCredentials
				? linearCredentials(old.encryptedCredentials).webhookSecret
				: null;
		const credentials = encrypt(
			JSON.stringify({ apiKey, webhookSecret: secret })
		);
		await tx
			.insert(integration)
			.values({
				organizationId: c.get('organizationId'),
				provider: 'linear',
				externalAccountId: org.id,
				externalAccountName: org.name,
				encryptedCredentials: credentials,
			})
			.onConflictDoUpdate({
				target: [integration.organizationId, integration.provider],
				set: {
					externalAccountId: org.id,
					externalAccountName: org.name,
					encryptedCredentials: credentials,
					connectedAt: new Date(),
					disconnectedAt: null,
				},
			});
	});
	return c.json({ ok: true });
});
linearRoutes.patch('/manage/integrations/linear', async (c) => {
	admin(c);
	const { webhookSecret } = z
		.object({ webhookSecret: z.string().trim().min(16).max(1000) })
		.parse(await c.req.json());
	await c.get('db').transaction(async (tx) => {
		const [initial] = await tx
			.select()
			.from(integration)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'linear')
				)
			);
		if (!initial)
			throw new HTTPException(400, { message: 'Connect Linear first.' });
		await lockLinear(tx, initial.id);
		const [connection] = await tx
			.select()
			.from(integration)
			.where(eq(integration.id, initial.id));
		if (connection!.disconnectedAt || !connection!.encryptedCredentials)
			throw new HTTPException(400, { message: 'Connect Linear first.' });
		await tx
			.update(integration)
			.set({
				encryptedCredentials: encrypt(
					JSON.stringify({
						...linearCredentials(connection!.encryptedCredentials),
						webhookSecret,
					})
				),
			})
			.where(eq(integration.id, connection!.id));
	});
	return c.json({ ok: true });
});
linearRoutes.delete('/manage/integrations/linear', async (c) => {
	admin(c);
	await c.get('db').transaction(async (tx) => {
		const [connection] = await tx
			.select()
			.from(integration)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'linear')
				)
			);
		if (!connection) return;
		await lockLinear(tx, connection.id);
		const links = await tx
			.select()
			.from(requestLinearIssue)
			.where(eq(requestLinearIssue.integrationId, connection.id));
		for (const link of links) {
			const [row] = await tx
				.select()
				.from(request)
				.where(eq(request.id, link.requestId))
				.for('update');
			if (row && !connection.disconnectedAt)
				await recordEvent(
					tx,
					row,
					{ actorId: identity(c).userId, source: 'team' },
					'linear_disconnected',
					undefined
				);
		}
		await tx
			.update(integration)
			.set({ encryptedCredentials: null, disconnectedAt: new Date() })
			.where(eq(integration.id, connection.id));
	});
	return c.json({ ok: true });
});
linearRoutes.post('/manage/requests/:id/linear', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	const { url } = z
		.object({ url: z.string().trim().max(2000) })
		.parse(await c.req.json());
	const [connection] = await c
		.get('db')
		.select()
		.from(integration)
		.where(
			and(
				eq(integration.organizationId, c.get('organizationId')),
				eq(integration.provider, 'linear')
			)
		);
	if (!connection?.encryptedCredentials || connection.disconnectedAt)
		throw new HTTPException(400, {
			message: 'Connect Linear in Integrations first.',
		});
	const issue = await readLinearIssue(
		linearCredentials(connection.encryptedCredentials).apiKey,
		url,
		connection.externalAccountId
	);
	await c.get('db').transaction(async (tx) => {
		await lockLinear(tx, connection.id);
		const [current] = await tx
			.select()
			.from(integration)
			.where(eq(integration.id, connection.id));
		if (
			current!.disconnectedAt ||
			current!.encryptedCredentials !== connection.encryptedCredentials
		)
			throw new HTTPException(409, {
				message: 'Linear connection changed. Please try again.',
			});
		const [locked] = await tx
			.select()
			.from(request)
			.where(eq(request.id, row.id))
			.for('update');
		const [old] = await tx
			.select()
			.from(requestLinearIssue)
			.where(eq(requestLinearIssue.requestId, row.id));
		if (
			old?.issueId === issue.id &&
			old.issueUpdatedAt > new Date(issue.updatedAt)
		)
			return;
		const values = {
			integrationId: connection.id,
			issueId: issue.id,
			identifier: issue.identifier,
			url: issue.url,
			stateName: issue.state.name,
			stateType: issue.state.type,
			issueUpdatedAt: new Date(issue.updatedAt),
		};
		await tx
			.insert(requestLinearIssue)
			.values({
				...values,
				requestId: row.id,
				organizationId: row.organizationId,
			})
			.onConflictDoUpdate({
				target: requestLinearIssue.requestId,
				set: values,
			});
		if (old?.issueId !== issue.id)
			await recordEvent(
				tx,
				locked!,
				{ actorId: identity(c).userId, source: 'team' },
				'linear_linked',
				{ linearUrl: { before: old?.url ?? null, after: issue.url } }
			);
		await applyLinearStatus(tx, row.id, issue);
	});
	return c.json({ ok: true });
});
linearRoutes.delete('/manage/requests/:id/linear', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	const [initial] = await c
		.get('db')
		.select()
		.from(requestLinearIssue)
		.where(eq(requestLinearIssue.requestId, row.id));
	if (initial)
		await c.get('db').transaction(async (tx) => {
			await lockLinear(tx, initial.integrationId);
			const [locked] = await tx
				.select()
				.from(request)
				.where(eq(request.id, row.id))
				.for('update');
			const [removed] = await tx
				.delete(requestLinearIssue)
				.where(
					and(
						eq(requestLinearIssue.requestId, row.id),
						eq(requestLinearIssue.id, initial.id)
					)
				)
				.returning();
			if (removed)
				await recordEvent(
					tx,
					locked!,
					{ actorId: identity(c).userId, source: 'team' },
					'linear_unlinked',
					{ linearUrl: { before: removed.url, after: null } }
				);
		});
	return c.json({ ok: true });
});
