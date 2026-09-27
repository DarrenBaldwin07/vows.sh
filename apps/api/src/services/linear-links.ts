import { and, eq, integration, request, requestLinearIssue } from '@repo/db';
import { HTTPException } from 'hono/http-exception';
import { identity, type ApiContext } from '../context.js';
import { linearCredentials, readLinearIssue } from '../linear.js';
import { recordEvent, type Transaction } from './request-events.js';
import { applyLinearStatus, lockLinear } from './linear-sync.js';

export async function prepareLinearLink(c: ApiContext, url: string) {
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
	return { connection, issue };
}

export async function attachLinearIssue(
	c: ApiContext,
	tx: Transaction,
	row: typeof request.$inferSelect,
	prepared: Awaited<ReturnType<typeof prepareLinearLink>>
) {
	const { connection, issue } = prepared;

	await lockLinear(tx, connection.id);
	const [current] = await tx
		.select()
		.from(integration)
		.where(eq(integration.id, connection.id));
	if (
		!current ||
		current.disconnectedAt ||
		current.encryptedCredentials !== connection.encryptedCredentials
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
}
