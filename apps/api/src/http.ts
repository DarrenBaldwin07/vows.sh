import { Hono } from 'hono';
import { agentError } from './agent-auth.js';
import { publicOrigin } from './middleware/public-origin.js';
import { createApiRoutes } from './routes/api.js';
import { createHealthRoutes } from './routes/health.js';
import { mcpRoutes } from './routes/mcp.js';
import { oauthRoutes } from './routes/oauth.js';

export function createHttpApp(
	options: Parameters<typeof createApiRoutes>[0] &
		Parameters<typeof createHealthRoutes>[0] = {}
) {
	const server = new Hono();
	server.onError((error, c) => agentError(error, c.req.raw));
	server.route('/', createHealthRoutes(options));
	server.use('*', publicOrigin);
	server.route('/', oauthRoutes);
	server.route('/', mcpRoutes);
	server.route('/', createApiRoutes(options));
	return server;
}
