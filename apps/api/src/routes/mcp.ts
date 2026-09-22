import { Hono } from 'hono';
import { resolveAgent, checkAgentOrigin } from '../agent-auth.js';
import { createAgentMcpHandler } from '../mcp.js';

export const mcpRoutes = new Hono();
mcpRoutes.on(['POST', 'GET', 'DELETE'], '/mcp', async (c) => {
	checkAgentOrigin(c.req.raw);
	const { principal, bindings } = await resolveAgent(c.req.raw);
	const response = await createAgentMcpHandler(principal, bindings).fetch(
		c.req.raw
	);
	response.headers.set('Cache-Control', 'no-store');
	return response;
});
