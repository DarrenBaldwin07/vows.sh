import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, desc, sql, customer, request } from '@repo/db';
import { getCustomer, type Env } from '../context.js';
import { statuses } from '../validation.js';

export const searchRoutes = new Hono<Env>();
searchRoutes.get('/manage/search', async (c) => {
	const input = z
		.object({
			q: z.string().trim().max(200).default(''),
			customerId: z.uuid().optional(),
			status: z.enum(statuses).optional(),
		})
		.parse(c.req.query());
	if (input.customerId) await getCustomer(c, input.customerId);
	const db = c.get('db');
	const organizationId = c.get('organizationId');
	const terms = input.q
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 12)
		.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`);
	const [customers, requests] = await Promise.all([
		input.customerId
			? Promise.resolve([])
			: db
					.select({
						id: customer.id,
						name: customer.name,
						domain: customer.domain,
						imageData: customer.imageData,
						archivedAt: customer.archivedAt,
					})
					.from(customer)
					.where(
						and(
							eq(customer.organizationId, organizationId),
							...terms.map(
								(term) =>
									sql`concat_ws(' ', ${customer.name}, ${customer.domain}) ilike ${term}`
							)
						)
					)
					.orderBy(desc(customer.updatedAt), customer.id)
					.limit(21),
		db
			.select({
				id: request.id,
				title: request.title,
				status: request.status,
				customerId: customer.id,
				customerName: customer.name,
				archivedAt: customer.archivedAt,
			})
			.from(request)
			.innerJoin(
				customer,
				and(
					eq(customer.id, request.customerId),
					eq(customer.organizationId, request.organizationId)
				)
			)
			.where(
				and(
					eq(request.organizationId, organizationId),
					input.customerId
						? eq(request.customerId, input.customerId)
						: undefined,
					input.status ? eq(request.status, input.status) : undefined,
					...terms.map(
						(term) =>
							sql`concat_ws(' ', ${request.title}, ${request.description}, ${request.internalNotes}, ${request.completionNote}, replace(${request.status}::text, '_', ' '), ${customer.name}, ${customer.domain}) ilike ${term}`
					)
				)
			)
			.orderBy(desc(request.updatedAt), request.id)
			.limit(31),
	]);
	return c.json({
		customers: customers.slice(0, 20),
		requests: requests.slice(0, 30),
		moreCustomers: customers.length > 20,
		moreRequests: requests.length > 30,
	});
});
