import type { MiddlewareHandler } from 'hono';

// The public origin is configuration, not a client-supplied forwarding header.
// Clerk cookies and the API's CSRF checks use this origin behind the Web proxy.
export const publicOrigin: MiddlewareHandler = async (c, next) => {
	const origin = new URL(process.env.APP_URL!).origin;
	const url = new URL(c.req.url);
	const request = new Request(
		`${origin}${url.pathname}${url.search}`,
		c.req.raw
	);
	const publicUrl = new URL(origin);
	request.headers.set('host', publicUrl.host);
	request.headers.set('x-forwarded-host', publicUrl.host);
	request.headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));
	c.req.raw = request;
	await next();
};
