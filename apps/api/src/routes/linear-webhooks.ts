import { lockLinear } from '../services/linear-sync.js';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
	and,
	eq,
	getDb,
	integration,
	isNull,
	linearWebhook,
	type Database,
} from '@repo/db';
import {
	linearCredentials,
	linearStatus,
	validLinearSignature,
} from '../linear.js';

export function createLinearWebhookRoutes(database: () => Database = getDb) {
	const routes = new Hono();
	routes.use('/api/webhooks/linear/*', bodyLimit({ maxSize: 1024 * 1024 }));
	routes.post('/api/webhooks/linear/:id', async (c) => {
		const db = database();
		const [connection] = await db
			.select()
			.from(integration)
			.where(
				and(
					eq(integration.id, c.req.param('id')),
					eq(integration.provider, 'linear'),
					isNull(integration.disconnectedAt)
				)
			);
		if (!connection?.encryptedCredentials)
			return c.json({ error: 'Webhook unavailable.' }, 401);
		const { webhookSecret } = linearCredentials(
			connection.encryptedCredentials
		);
		const raw = new Uint8Array(await c.req.arrayBuffer());
		if (
			!webhookSecret ||
			!validLinearSignature(
				raw,
				c.req.header('Linear-Signature'),
				webhookSecret
			)
		)
			return c.json({ error: 'Invalid signature.' }, 401);
		let payload: unknown;
		try {
			payload = JSON.parse(new TextDecoder().decode(raw));
		} catch {
			return c.json({ error: 'Invalid payload.' }, 400);
		}
		const envelope = z
			.object({
				organizationId: z.string(),
				webhookTimestamp: z.number().int(),
				type: z.string(),
				action: z.string(),
			})
			.safeParse(payload);
		if (!envelope.success) return c.json({ error: 'Invalid payload.' }, 400);
		if (
			envelope.data.organizationId !== connection.externalAccountId ||
			Math.abs(Date.now() - envelope.data.webhookTimestamp) > 60000
		)
			return c.json({ error: 'Invalid webhook workspace or timestamp.' }, 401);
		if (
			envelope.data.type !== 'Issue' ||
			!['create', 'update', 'remove'].includes(envelope.data.action)
		)
			return c.json({ ok: true });
		const parsed = z
			.object({
				createdAt: z.iso.datetime(),
				data: z.object({
					id: z.string().min(1),
					updatedAt: z.iso.datetime(),
					state: z
						.object({ name: z.string().max(200), type: z.string().max(50) })
						.optional(),
				}),
			})
			.safeParse(payload);
		if (
			!parsed.success ||
			(envelope.data.action !== 'remove' && !parsed.data.data.state)
		)
			return c.json({ error: 'Invalid issue payload.' }, 400);
		const state = parsed.data.data.state ?? { name: '', type: '' };
		if (envelope.data.action !== 'remove') linearStatus(state);
		// Persist before acknowledging. Duplicate deliveries have no duplicate effects.
		const id = createHash('sha256')
			.update(connection.id)
			.update(raw)
			.digest('hex');
		await db.transaction(async (tx) => {
			await lockLinear(tx, connection.id);
			const [current] = await tx
				.select()
				.from(integration)
				.where(eq(integration.id, connection.id));
			if (
				current?.disconnectedAt ||
				current?.encryptedCredentials !== connection.encryptedCredentials
			)
				return;
			await tx
				.insert(linearWebhook)
				.values({
					id,
					integrationId: connection.id,
					issueId: parsed.data.data.id,
					action: envelope.data.action,
					stateName: state.name,
					stateType: state.type,
					issueUpdatedAt: new Date(
						envelope.data.action === 'remove'
							? parsed.data.createdAt
							: parsed.data.data.updatedAt
					),
				})
				.onConflictDoNothing();
		});
		return c.json({ ok: true });
	});
	return routes;
}
