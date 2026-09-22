import { Hono } from 'hono';
import { app } from '../app.js';
import { sessionBindings } from '../clerk.js';
import { resolveAgent, checkAgentOrigin } from '../agent-auth.js';
import { executeAgentCall } from '../agent-service.js';

export function createApiRoutes({
	authenticateSession = sessionBindings,
	dispatch = app.fetch,
} = {}) {
	const routes = new Hono();
	routes.all('/api/*', async (c) => {
		const request = c.req.raw;
		if (request.headers.has('Authorization')) {
			checkAgentOrigin(request);
			const { principal, bindings } = await resolveAgent(request);
			const url = new URL(request.url);
			const body = ['GET', 'HEAD'].includes(request.method)
				? undefined
				: await request.json();
			const result = await executeAgentCall(
				principal,
				{
					path: url.pathname.slice(4) + url.search,
					method: request.method,
					body,
					idempotencyKey: request.headers.get('Idempotency-Key') ?? undefined,
					expectedUpdatedAt:
						request.headers.get('X-Expected-Updated-At') ?? undefined,
				},
				bindings
			);
			return c.json(result, { headers: { 'Cache-Control': 'no-store' } });
		}
		const bindings = await authenticateSession(request);
		if (bindings instanceof Response) return bindings;
		return dispatch(request, bindings);
	});
	return routes;
}
