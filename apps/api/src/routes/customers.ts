import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, desc, sql, customer, request } from '@repo/db';
import { getCustomer, type Env } from '../context.js';
import { customerInput } from '../validation.js';

export const customersRoutes = new Hono<Env>();
customersRoutes.get('/manage/customers', async (c) => {
	const rows = await c
		.get('db')
		.select({
			id: customer.id,
			name: customer.name,
			domain: customer.domain,
			imageData: customer.imageData,
			archivedAt: customer.archivedAt,
			updatedAt: customer.updatedAt,
			openCount: sql<number>`(count(${request.id}) filter (where ${request.status} not in ('done', 'canceled')))::int`,
			totalCount: sql<number>`count(${request.id})::int`,
		})
		.from(customer)
		.leftJoin(
			request,
			and(
				eq(request.customerId, customer.id),
				eq(request.organizationId, customer.organizationId)
			)
		)
		.where(eq(customer.organizationId, c.get('organizationId')))
		.groupBy(customer.id)
		.orderBy(desc(customer.updatedAt));
	return c.json(rows);
});
customersRoutes.post('/manage/customers', async (c) => {
	const data = customerInput.parse(await c.req.json());
	const [row] = await c
		.get('db')
		.insert(customer)
		.values({ ...data, organizationId: c.get('organizationId') })
		.returning();
	return c.json(row, 201);
});
customersRoutes.get('/manage/customers/:id', async (c) => {
	const owner = await getCustomer(c, c.req.param('id'));
	const rows = await c
		.get('db')
		.select()
		.from(request)
		.where(eq(request.customerId, owner.id))
		.orderBy(desc(request.updatedAt));
	return c.json({ customer: owner, requests: rows });
});
customersRoutes.patch('/manage/customers/:id', async (c) => {
	const owner = await getCustomer(c, c.req.param('id'));
	const data = customerInput
		.partial()
		.extend({ archived: z.boolean().optional() })
		.parse(await c.req.json());
	const { archived, ...fields } = data;
	const [row] = await c
		.get('db')
		.update(customer)
		.set({
			...fields,
			...(archived !== undefined
				? { archivedAt: archived ? new Date() : null }
				: {}),
			updatedAt: new Date(),
		})
		.where(eq(customer.id, owner.id))
		.returning();
	return c.json(row);
});
