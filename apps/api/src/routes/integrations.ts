import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, integration } from '@repo/db';
import { admin, type Env } from '../context.js';
import { slackConfigured } from '../slack.js';

export const integrationsRoutes = new Hono<Env>();
integrationsRoutes.get('/manage/integrations', async (c) => {
	const [connection] = await c
		.get('db')
		.select({
			id: integration.id,
			name: integration.externalAccountName,
			notifyOnDone: integration.notifyOnDone,
			disconnectedAt: integration.disconnectedAt,
		})
		.from(integration)
		.where(
			and(
				eq(integration.organizationId, c.get('organizationId')),
				eq(integration.provider, 'slack')
			)
		);
	return c.json({ slack: connection ?? null, configured: slackConfigured() });
});
integrationsRoutes.patch('/manage/integrations/slack', async (c) => {
	admin(c);
	const data = z
		.object({ notifyOnDone: z.boolean() })
		.parse(await c.req.json());
	await c
		.get('db')
		.update(integration)
		.set(data)
		.where(
			and(
				eq(integration.organizationId, c.get('organizationId')),
				eq(integration.provider, 'slack')
			)
		);
	return c.json({ ok: true });
});
integrationsRoutes.delete('/manage/integrations/slack', async (c) => {
	admin(c);
	await c
		.get('db')
		.update(integration)
		.set({
			encryptedCredentials: null,
			disconnectedAt: new Date(),
			notifyOnDone: false,
		})
		.where(
			and(
				eq(integration.organizationId, c.get('organizationId')),
				eq(integration.provider, 'slack')
			)
		);
	return c.json({ ok: true });
});
