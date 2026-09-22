import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
	getDb,
	and,
	eq,
	desc,
	isNull,
	inArray,
	or,
	sql,
	customer,
	customerAccess,
	customerShareLink,
	request,
	requestEvent,
	integration,
	requestSlackThread,
	notificationDelivery,
	type Database,
} from '@repo/db';
import {
	admin,
	ensureOrganization,
	getCustomer,
	identity,
	type ApiContext,
	type Env,
} from './context.js';
import {
	accessInput,
	customerInput,
	parseSlackLink,
	requestInput,
	shouldNotify,
	statusInput,
	statuses,
} from './validation.js';
import { newToken, slackConfigured } from './slack.js';
import { slackRoutes } from './slack-routes.js';

async function findRequest(c: ApiContext, id: string) {
	const [row] = await c
		.get('db')
		.select()
		.from(request)
		.where(
			and(
				eq(request.id, id),
				eq(request.organizationId, c.get('organizationId'))
			)
		);
	if (!row) throw new HTTPException(404, { message: 'Request not found.' });
	return row;
}
async function saveRequest(
	c: ApiContext,
	customerId: string,
	id?: string,
	statusOnly?: string
) {
	const db = c.get('db');
	const owner = await getCustomer(c, customerId);
	if (owner.archivedAt)
		throw new HTTPException(400, {
			message: 'Restore this customer before editing requests.',
		});
	const data = statusOnly ? null : requestInput.parse(await c.req.json());
	if (
		data?.assigneeId &&
		!((await c.env.members?.()) ?? []).some((m) => m.id === data.assigneeId)
	)
		throw new HTTPException(400, {
			message: 'Choose a current workspace member.',
		});
	let parsedThread: ReturnType<typeof parseSlackLink> | null = null;
	if (data?.slackUrl) {
		try {
			parsedThread = parseSlackLink(data.slackUrl);
		} catch (error) {
			throw new HTTPException(400, { message: (error as Error).message });
		}
	}
	const [connection] = await db
		.select()
		.from(integration)
		.where(
			and(
				eq(integration.organizationId, c.get('organizationId')),
				eq(integration.provider, 'slack'),
				isNull(integration.disconnectedAt)
			)
		);
	if (parsedThread && !connection)
		throw new HTTPException(400, {
			message: 'Connect Slack before attaching a thread.',
		});
	return db.transaction(async (tx) => {
		const [existing] = id
			? await tx
					.select()
					.from(request)
					.where(
						and(
							eq(request.id, id),
							eq(request.organizationId, c.get('organizationId'))
						)
					)
					.for('update')
			: [];
		if (id && !existing)
			throw new HTTPException(404, { message: 'Request not found.' });
		const status = statusOnly
			? statusInput.parse({ status: statusOnly }).status
			: data!.status;
		const fields = data
			? {
					title: data.title,
					description: data.description,
					internalNotes: data.internalNotes,
					assigneeId: data.assigneeId,
					completionNote: data.completionNote,
					notifyOnDone: data.notifyOnDone,
				}
			: {};
		const values = {
			...fields,
			status,
			updatedAt: new Date(),
			completedAt:
				status === 'done' ? (existing?.completedAt ?? new Date()) : null,
		};
		const [saved] = existing
			? await tx
					.update(request)
					.set(values)
					.where(eq(request.id, existing.id))
					.returning()
			: await tx
					.insert(request)
					.values({
						...values,
						title: data!.title,
						organizationId: c.get('organizationId'),
						customerId,
						createdBy: identity(c).userId,
					})
					.returning();
		const result = saved!;
		if (data) {
			const [oldThread] = await tx
				.select()
				.from(requestSlackThread)
				.where(eq(requestSlackThread.requestId, result.id));
			if (
				oldThread &&
				(!parsedThread ||
					oldThread.channelId !== parsedThread.channelId ||
					oldThread.threadTs !== parsedThread.threadTs)
			) {
				await tx
					.update(notificationDelivery)
					.set({
						status: 'canceled',
						lastError:
							'Slack destination changed. Send an update explicitly to the new thread.',
					})
					.where(
						and(
							eq(notificationDelivery.requestId, result.id),
							inArray(notificationDelivery.status, ['pending', 'sending'])
						)
					);
			}
			if (parsedThread && connection) {
				await tx
					.insert(requestSlackThread)
					.values({
						...parsedThread,
						requestId: result.id,
						organizationId: c.get('organizationId'),
						integrationId: connection.id,
					})
					.onConflictDoUpdate({
						target: requestSlackThread.requestId,
						set: { ...parsedThread, integrationId: connection.id },
					});
			} else {
				await tx
					.delete(requestSlackThread)
					.where(eq(requestSlackThread.requestId, result.id));
			}
		}
		if (!existing || existing.status !== status) {
			const [event] = await tx
				.insert(requestEvent)
				.values({
					requestId: result.id,
					actorId: identity(c).userId,
					fromStatus: existing?.status ?? null,
					toStatus: status,
				})
				.returning();
			const [thread] = await tx
				.select()
				.from(requestSlackThread)
				.where(eq(requestSlackThread.requestId, result.id));
			const prior = await tx
				.select({ id: notificationDelivery.id })
				.from(notificationDelivery)
				.where(
					and(
						eq(notificationDelivery.requestId, result.id),
						inArray(notificationDelivery.status, [
							'sent',
							'sending',
							'uncertain',
							'pending',
						])
					)
				);
			if (
				shouldNotify({
					previousStatus: existing?.status ?? '',
					status,
					enabled: Boolean(
						connection && (result.notifyOnDone ?? connection.notifyOnDone)
					),
					hasThread: Boolean(thread),
					previouslyDelivered: prior.length > 0,
				})
			) {
				await tx.insert(notificationDelivery).values({
					requestId: result.id,
					eventId: event!.id,
					threadId: thread!.id,
				});
			}
			if (status !== 'done')
				await tx
					.update(notificationDelivery)
					.set({ status: 'canceled', lastError: 'Request reopened.' })
					.where(
						and(
							eq(notificationDelivery.requestId, result.id),
							inArray(notificationDelivery.status, ['pending', 'sending'])
						)
					);
		}
		await tx
			.update(customer)
			.set({ updatedAt: new Date() })
			.where(eq(customer.id, customerId));
		return result;
	});
}

export function createApp(database: () => Database = getDb) {
	const app = new Hono<Env>().basePath('/api');
	app.onError((error, c) => {
		if (error instanceof HTTPException)
			return c.json({ error: error.message }, error.status);
		if (error instanceof z.ZodError)
			return c.json(
				{
					error: error.issues
						.map((i) => `${i.path.join('.')}: ${i.message}`)
						.join('; '),
				},
				400
			);
		if (error instanceof SyntaxError)
			return c.json({ error: 'Invalid JSON body.' }, 400);
		console.error('API request failed', error.name);
		return c.json({ error: 'Something went wrong. Please try again.' }, 500);
	});
	app.use('*', async (c, next) => {
		c.header('Cache-Control', 'private, no-store');
		c.header('Referrer-Policy', 'no-referrer');
		identity(c);
		if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
			const origin = c.req.header('Origin');
			if (!origin || origin !== new URL(c.req.url).origin)
				throw new HTTPException(403, {
					message: 'Request origin is not allowed.',
				});
			if (!c.req.header('Content-Type')?.startsWith('application/json'))
				throw new HTTPException(415, { message: 'Send JSON.' });
		}
		c.set('db', database());
		await next();
	});
	app.get('/portal/:token', async (c) => {
		const user = identity(c);
		const [link] = await c
			.get('db')
			.select({ customerId: customerShareLink.customerId })
			.from(customerShareLink)
			.where(
				and(
					eq(customerShareLink.token, c.req.param('token')),
					isNull(customerShareLink.revokedAt)
				)
			);
		if (!link)
			throw new HTTPException(404, {
				message: 'This link is unavailable. Ask your contact for a new link.',
			});
		const [access] = user.verifiedEmails.length
			? await c
					.get('db')
					.select()
					.from(customerAccess)
					.where(
						and(
							eq(customerAccess.customerId, link.customerId),
							isNull(customerAccess.revokedAt),
							or(
								isNull(customerAccess.clerkUserId),
								eq(customerAccess.clerkUserId, user.userId)
							),
							inArray(
								customerAccess.email,
								user.verifiedEmails.map((e) => e.toLowerCase())
							)
						)
					)
			: [];
		if (!access || (access.clerkUserId && access.clerkUserId !== user.userId))
			throw new HTTPException(403, {
				message:
					'This account does not have access. Sign in with an invited, verified email or ask your contact to add you.',
			});
		await c
			.get('db')
			.update(customerAccess)
			.set({ clerkUserId: user.userId })
			.where(
				and(
					eq(customerAccess.id, access.id),
					isNull(customerAccess.clerkUserId)
				)
			);
		const [owner] = await c
			.get('db')
			.select({ name: customer.name, archivedAt: customer.archivedAt })
			.from(customer)
			.where(eq(customer.id, link.customerId));
		if (!owner || owner.archivedAt)
			throw new HTTPException(404, { message: 'This portal is unavailable.' });
		const rows = await c
			.get('db')
			.select({
				id: request.id,
				title: request.title,
				description: request.description,
				status: request.status,
				updatedAt: request.updatedAt,
				completedAt: request.completedAt,
				completionNote: request.completionNote,
			})
			.from(request)
			.where(eq(request.customerId, link.customerId))
			.orderBy(desc(request.updatedAt));
		return c.json({ customer: { name: owner.name }, requests: rows });
	});
	app.use('/manage/*', async (c, next) => {
		await ensureOrganization(c);
		await next();
	});
	app.get('/manage/search', async (c) => {
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
	app.get('/manage/members', async (c) =>
		c.json((await c.env.members?.()) ?? [])
	);
	app.get('/manage/customers', async (c) => {
		const rows = await c
			.get('db')
			.select({
				id: customer.id,
				name: customer.name,
				domain: customer.domain,
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
	app.post('/manage/customers', async (c) => {
		const data = customerInput.parse(await c.req.json());
		const [row] = await c
			.get('db')
			.insert(customer)
			.values({ ...data, organizationId: c.get('organizationId') })
			.returning();
		return c.json(row, 201);
	});
	app.get('/manage/customers/:id', async (c) => {
		const owner = await getCustomer(c, c.req.param('id'));
		const rows = await c
			.get('db')
			.select()
			.from(request)
			.where(eq(request.customerId, owner.id))
			.orderBy(desc(request.updatedAt));
		return c.json({ customer: owner, requests: rows });
	});
	app.patch('/manage/customers/:id', async (c) => {
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
	app.get('/manage/customers/:id/sharing', async (c) => {
		admin(c);
		const owner = await getCustomer(c, c.req.param('id'));
		const [link] = await c
			.get('db')
			.select({
				id: customerShareLink.id,
				token: customerShareLink.token,
				createdAt: customerShareLink.createdAt,
			})
			.from(customerShareLink)
			.where(
				and(
					eq(customerShareLink.customerId, owner.id),
					isNull(customerShareLink.revokedAt)
				)
			);
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
	app.post('/manage/customers/:id/sharing', async (c) => {
		admin(c);
		const owner = await getCustomer(c, c.req.param('id'));
		const token = newToken();
		await c.get('db').transaction(async (tx) => {
			await tx
				.select()
				.from(customer)
				.where(eq(customer.id, owner.id))
				.for('update');
			await tx
				.update(customerShareLink)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(customerShareLink.customerId, owner.id),
						isNull(customerShareLink.revokedAt)
					)
				);
			await tx
				.insert(customerShareLink)
				.values({ customerId: owner.id, token });
		});
		return c.json({ path: `/share/${token}` });
	});
	app.delete('/manage/customers/:id/sharing', async (c) => {
		admin(c);
		const owner = await getCustomer(c, c.req.param('id'));
		await c
			.get('db')
			.update(customerShareLink)
			.set({ revokedAt: new Date() })
			.where(eq(customerShareLink.customerId, owner.id));
		return c.json({ ok: true });
	});
	app.post('/manage/customers/:id/access', async (c) => {
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
	app.delete('/manage/customers/:id/access/:accessId', async (c) => {
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
	app.post('/manage/customers/:id/requests', async (c) =>
		c.json(await saveRequest(c, c.req.param('id')), 201)
	);
	app.get('/manage/requests/:id', async (c) => {
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
	app.put('/manage/requests/:id', async (c) => {
		const row = await findRequest(c, c.req.param('id'));
		return c.json(await saveRequest(c, row.customerId, row.id));
	});
	app.patch('/manage/requests/:id/status', async (c) => {
		const row = await findRequest(c, c.req.param('id'));
		const { status } = statusInput.parse(await c.req.json());
		return c.json(await saveRequest(c, row.customerId, row.id, status));
	});
	app.post('/manage/requests/:id/notify', async (c) => {
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
	app.get('/manage/integrations', async (c) => {
		const [connection] = await c
			.get('db')
			.select({
				id: integration.id,
				name: integration.externalAccountName,
				notifyOnDone: integration.notifyOnDone,
				disconnectedAt: integration.disconnectedAt,
			})
			.from(integration)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'slack')
				)
			);
		return c.json({ slack: connection ?? null, configured: slackConfigured() });
	});
	app.patch('/manage/integrations/slack', async (c) => {
		admin(c);
		const data = z
			.object({ notifyOnDone: z.boolean() })
			.parse(await c.req.json());
		await c
			.get('db')
			.update(integration)
			.set(data)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'slack')
				)
			);
		return c.json({ ok: true });
	});
	app.delete('/manage/integrations/slack', async (c) => {
		admin(c);
		await c
			.get('db')
			.update(integration)
			.set({
				encryptedCredentials: null,
				disconnectedAt: new Date(),
				notifyOnDone: false,
			})
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'slack')
				)
			);
		return c.json({ ok: true });
	});
	app.route('/manage/slack', slackRoutes);
	return app;
}
export const app = createApp();
export type AppType = typeof app;
