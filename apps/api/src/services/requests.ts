import { HTTPException } from 'hono/http-exception';
import {
	and,
	eq,
	isNull,
	inArray,
	customer,
	request,
	requestEvent,
	integration,
	requestSlackThread,
	notificationDelivery,
} from '@repo/db';
import { getCustomer, identity, type ApiContext } from '../context.js';
import {
	parseSlackLink,
	requestInput,
	shouldNotify,
	statusInput,
} from '../validation.js';

export async function findRequest(c: ApiContext, id: string) {
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
export async function saveRequest(
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
			updatedAt: new Date(
				Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)
			),
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
