import { Hono } from 'hono';
import {
	and,
	eq,
	isNull,
	customer,
	customerShareLink,
	portalPath,
} from '@repo/db';
import type { Env } from '../context.js';

// Only branding is public; portal contents still require an invited account.
export const portalPreviewRoutes = new Hono<Env>();
for (const path of [
	'/portal-preview/:token',
	'/portal-preview/:workspace/:customer',
]) {
	portalPreviewRoutes.get(path, async (c) => {
		const db = c.get('db');
		const selection = { name: customer.name, imageData: customer.imageData };
		const active = and(
			isNull(customerShareLink.revokedAt),
			isNull(customer.archivedAt)
		);
		const [preview] = c.req.param('workspace')
			? await db
					.select(selection)
					.from(portalPath)
					.innerJoin(
						customerShareLink,
						eq(portalPath.shareLinkId, customerShareLink.id)
					)
					.innerJoin(customer, eq(customerShareLink.customerId, customer.id))
					.where(
						and(
							active,
							eq(
								portalPath.path,
								`/share/${c.req.param('workspace')}/${c.req.param('customer')}`
							)
						)
					)
			: await db
					.select(selection)
					.from(customerShareLink)
					.innerJoin(customer, eq(customerShareLink.customerId, customer.id))
					.where(
						and(active, eq(customerShareLink.token, c.req.param('token')!))
					);
		if (!preview) return c.notFound();
		if (c.req.query('image') === '1') {
			const match =
				/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
					preview.imageData ?? ''
				);
			if (!match) return c.notFound();
			return new Response(Buffer.from(match[2]!, 'base64'), {
				headers: {
					'Content-Type': match[1]!,
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}
		return c.json({ name: preview.name, hasImage: Boolean(preview.imageData) });
	});
}

export function isPortalPreviewRequest(request: Request) {
	return (
		['GET', 'HEAD'].includes(request.method) &&
		/^\/api\/portal-preview\/[^/]+(?:\/[^/]+)?$/.test(
			new URL(request.url).pathname
		)
	);
}
