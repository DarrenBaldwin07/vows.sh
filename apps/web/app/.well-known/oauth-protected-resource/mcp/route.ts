export const dynamic = 'force-dynamic';
export function GET(request: Request) {
	if (!process.env.CLERK_OAUTH_ISSUER)
		return Response.json(
			{ error: 'OAuth is not configured. Use a bearer API key.' },
			{ status: 404 }
		);
	return Response.json(
		{
			resource: new URL('/mcp', process.env.APP_URL ?? request.url).href,
			authorization_servers: [process.env.CLERK_OAUTH_ISSUER],
			scopes_supported: ['vows:read', 'vows:write'],
			bearer_methods_supported: ['header'],
		},
		{
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-store',
			},
		}
	);
}
export function OPTIONS() {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
		},
	});
}
