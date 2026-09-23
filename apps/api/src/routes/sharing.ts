import { Hono } from 'hono';
import {
	and,
	eq,
	isNull,
	sql,
	customer,
	customerAccess,
	customerShareLink,
} from '@repo/db';
import { admin, getCustomer, type Env } from '../context.js';
import { accessInput } from '../validation.js';
import {
	publishPortalLink,
	portalAddressInput,
} from '../services/portal-links.js';

export const sharingRoutes = new Hono<Env>();
sharingRoutes.get('/manage/customers/:id/sharing', async (c) => {
	admin(c);
	const owner = await getCustomer(c, c.req.param('id'));
	const link = await publishPortalLink(c, owner.id);
	const access = await c
		.get('db')
		.select({
			id: customerAccess.id,
			email: customerAccess.email,
			accepted: sql<boolean>`${customerAccess.clerkUserId} is not null`,
		})
		.from(customerAccess)
		.where(
			and(
				eq(customerAccess.customerId, owner.id),
				isNull(customerAccess.revokedAt)
			)
		);
	return c.json({ link: link ?? null, access });
});
sharingRoutes.post('/manage/customers/:id/sharing', async (c) => {
	admin(c);
	const owner = await getCustomer(c, c.req.param('id'));
	const link = await publishPortalLink(c, owner.id, { rotate: true });
	return c.json({ path: link!.path, legacyPath: `/share/${link!.token}` });
});
sharingRoutes.patch('/manage/customers/:id/sharing', async (c) => {
	admin(c);
	const address = portalAddressInput.parse(await c.req.json());
	const link = await publishPortalLink(c, c.req.param('id'), { address });
	return c.json({ path: link!.path });
});
sharingRoutes.delete('/manage/customers/:id/sharing', async (c) => {
	admin(c);
	const owner = await getCustomer(c, c.req.param('id'));
	await c.get('db').transaction(async (tx) => {
		await tx
			.select()
			.from(customer)
			.where(eq(customer.id, owner.id))
			.for('update');
		await tx
			.update(customerShareLink)
			.set({ revokedAt: new Date() })
			.where(eq(customerShareLink.customerId, owner.id));
	});
	return c.json({ ok: true });
});
sharingRoutes.post('/manage/customers/:id/access', async (c) => {
	admin(c);
	const owner = await getCustomer(c, c.req.param('id'));
	const { email } = accessInput.parse(await c.req.json());
	await c
		.get('db')
		.insert(customerAccess)
		.values({ customerId: owner.id, email })
		.onConflictDoUpdate({
			target: [customerAccess.customerId, customerAccess.email],
			set: { revokedAt: null, clerkUserId: null },
		});
	return c.json({ ok: true });
});
sharingRoutes.delete('/manage/customers/:id/access/:accessId', async (c) => {
	admin(c);
	const owner = await getCustomer(c, c.req.param('id'));
	await c
		.get('db')
		.update(customerAccess)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(customerAccess.id, c.req.param('accessId')),
				eq(customerAccess.customerId, owner.id)
			)
		);
	return c.json({ ok: true });
});
