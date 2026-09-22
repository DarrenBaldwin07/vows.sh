import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getDb, type Database } from '@repo/db';
import { identity, ensureOrganization, type Env } from './context.js';
import { agentKeyRoutes } from './routes/agent-keys.js';
import { slackRoutes } from './routes/slack.js';
import { portalRoutes } from './routes/portal.js';
import { searchRoutes } from './routes/search.js';
import { membersRoutes } from './routes/members.js';
import { customersRoutes } from './routes/customers.js';
import { sharingRoutes } from './routes/sharing.js';
import { requestsRoutes } from './routes/requests.js';
import { integrationsRoutes } from './routes/integrations.js';

export function createApp(database: () => Database = getDb) {
	const app = new Hono<Env>().basePath('/api');
	app.onError((error, c) => {
		if (error instanceof HTTPException)
			return c.json({ error: error.message }, error.status);
		if (error instanceof z.ZodError)
			return c.json(
				{
					error: error.issues
						.map((i) => `${i.path.join('.')}: ${i.message}`)
						.join('; '),
				},
				400
			);
		if (error instanceof SyntaxError)
			return c.json({ error: 'Invalid JSON body.' }, 400);
		console.error('API request failed', error.name);
		return c.json({ error: 'Something went wrong. Please try again.' }, 500);
	});
	app.use('*', async (c, next) => {
		c.header('Cache-Control', 'private, no-store');
		c.header('Referrer-Policy', 'no-referrer');
		identity(c);
		if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
			const origin = c.req.header('Origin');
			if (!origin || origin !== new URL(c.req.url).origin)
				throw new HTTPException(403, {
					message: 'Request origin is not allowed.',
				});
			if (!c.req.header('Content-Type')?.startsWith('application/json'))
				throw new HTTPException(415, { message: 'Send JSON.' });
		}
		c.set('db', database());
		await next();
	});
	app.route('/', portalRoutes);
	app.use('/manage/*', async (c, next) => {
		await ensureOrganization(c);
		await next();
	});
	app.route('/manage/agent-keys', agentKeyRoutes);
	app.route('/', searchRoutes);
	app.route('/', membersRoutes);
	app.route('/', customersRoutes);
	app.route('/', sharingRoutes);
	app.route('/', requestsRoutes);
	app.route('/', integrationsRoutes);
	app.route('/manage/slack', slackRoutes);
	return app;
}
export const app = createApp();
export type AppType = typeof app;
