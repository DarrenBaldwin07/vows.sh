import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
	and,
	eq,
	desc,
	isNull,
	inArray,
	request,
	requestEvent,
	integration,
	requestSlackThread,
	notificationDelivery,
} from '@repo/db';
import { identity, type Env } from '../context.js';
import { statusInput } from '../validation.js';
import { findRequest, saveRequest } from '../services/requests.js';

export const requestsRoutes = new Hono<Env>();
requestsRoutes.post('/manage/customers/:id/requests', async (c) =>
	c.json(await saveRequest(c, c.req.param('id')), 201)
);
requestsRoutes.get('/manage/requests/:id', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	const [thread] = await c
		.get('db')
		.select({ permalink: requestSlackThread.permalink })
		.from(requestSlackThread)
		.where(eq(requestSlackThread.requestId, row.id));
	const events = await c
		.get('db')
		.select()
		.from(requestEvent)
		.where(eq(requestEvent.requestId, row.id))
		.orderBy(desc(requestEvent.createdAt));
	const deliveries = await c
		.get('db')
		.select({
			id: notificationDelivery.id,
			status: notificationDelivery.status,
			sentAt: notificationDelivery.sentAt,
			lastError: notificationDelivery.lastError,
			createdAt: notificationDelivery.createdAt,
		})
		.from(notificationDelivery)
		.where(eq(notificationDelivery.requestId, row.id))
		.orderBy(desc(notificationDelivery.createdAt));
	return c.json({
		...row,
		slackUrl: thread?.permalink ?? null,
		events,
		deliveries,
	});
});
requestsRoutes.put('/manage/requests/:id', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	return c.json(await saveRequest(c, row.customerId, row.id));
});
requestsRoutes.patch('/manage/requests/:id/status', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	const { status } = statusInput.parse(await c.req.json());
	return c.json(await saveRequest(c, row.customerId, row.id, status));
});
requestsRoutes.post('/manage/requests/:id/notify', async (c) => {
	const row = await findRequest(c, c.req.param('id'));
	await c.get('db').transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(request)
			.where(eq(request.id, row.id))
			.for('update');
		if (locked!.status !== 'done')
			throw new HTTPException(400, {
				message: 'Complete the request first.',
			});
		const [thread] = await tx
			.select()
			.from(requestSlackThread)
			.where(eq(requestSlackThread.requestId, row.id));
		const [connection] = thread
			? await tx
					.select()
					.from(integration)
					.where(
						and(
							eq(integration.id, thread.integrationId),
							isNull(integration.disconnectedAt)
						)
					)
			: [];
		if (
			!thread ||
			!connection ||
			!(locked!.notifyOnDone ?? connection.notifyOnDone)
		)
			throw new HTTPException(400, {
				message:
					'Attach a Slack thread and enable completion notifications first.',
			});
		const active = await tx
			.select()
			.from(notificationDelivery)
			.where(
				and(
					eq(notificationDelivery.requestId, row.id),
					inArray(notificationDelivery.status, ['pending', 'sending'])
				)
			);
		if (active.length)
			throw new HTTPException(409, {
				message: 'A notification is already queued.',
			});
		const [event] = await tx
			.insert(requestEvent)
			.values({
				requestId: row.id,
				actorId: identity(c).userId,
				fromStatus: 'done',
				toStatus: 'done',
			})
			.returning();
		await tx
			.insert(notificationDelivery)
			.values({ requestId: row.id, eventId: event!.id, threadId: thread.id });
	});
	return c.json({ ok: true });
});
