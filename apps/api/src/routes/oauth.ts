import { Hono } from 'hono';

export const oauthRoutes = new Hono();
oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', (c) => {
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Cache-Control', 'no-store');
	if (!process.env.CLERK_OAUTH_ISSUER)
		return c.json(
			{ error: 'OAuth is not configured. Use a bearer API key.' },
			404
		);
	return c.json({
		resource: new URL('/mcp', process.env.APP_URL!).href,
		authorization_servers: [process.env.CLERK_OAUTH_ISSUER],
		scopes_supported: ['vows:read', 'vows:write'],
		bearer_methods_supported: ['header'],
	});
});
oauthRoutes.options('/.well-known/oauth-protected-resource/mcp', (c) => {
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
	return c.body(null, 204);
});
