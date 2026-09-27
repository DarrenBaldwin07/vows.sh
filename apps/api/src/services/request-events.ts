import {
	and,
	eq,
	inArray,
	isNull,
	integration,
	notificationDelivery,
	requestEvent,
	requestSlackThread,
	type Database,
	type request,
} from '@repo/db';
import { shouldNotify } from '../validation.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type RequestRow = typeof request.$inferSelect;
export type EventActor = {
	actorId: string;
	source: 'team' | 'customer' | 'linear' | 'system' | 'agent';
};
export async function recordEvent(
	tx: Transaction,
	row: RequestRow,
	actor: EventActor,
	kind: string,
	changes?: Record<string, { before: unknown; after: unknown }>,
	visible = true
) {
	const [event] = await tx
		.insert(requestEvent)
		.values({
			requestId: row.id,
			...actor,
			kind,
			changes,
			public: visible,
			fromStatus: row.status,
			toStatus: row.status,
		})
		.returning();
	return event!;
}

export async function recordRequestChanges(
	tx: Transaction,
	previous: RequestRow | undefined,
	row: RequestRow,
	actor: EventActor
) {
	if (!previous || previous.status !== row.status) {
		const [event] = await tx
			.insert(requestEvent)
			.values({
				requestId: row.id,
				...actor,
				kind: previous ? 'status_changed' : 'created',
				changes: previous
					? null
					: Object.fromEntries(
							[
								'title',
								'description',
								'internalNotes',
								'assigneeId',
								'completionNote',
								'notifyOnDone',
							].map((field) => [
								field,
								{ before: null, after: row[field as keyof RequestRow] },
							])
						),
				fromStatus: previous?.status ?? null,
				toStatus: row.status,
			})
			.returning();
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
		const prior = await tx
			.select({ id: notificationDelivery.id })
			.from(notificationDelivery)
			.where(
				and(
					eq(notificationDelivery.requestId, row.id),
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
				previousStatus: previous?.status ?? '',
				status: row.status,
				enabled: Boolean(
					connection && (row.notifyOnDone ?? connection.notifyOnDone)
				),
				hasThread: Boolean(thread),
				previouslyDelivered: prior.length > 0,
			})
		) {
			await tx.insert(notificationDelivery).values({
				requestId: row.id,
				eventId: event!.id,
				threadId: thread!.id,
			});
		}
		if (row.status !== 'done')
			await tx
				.update(notificationDelivery)
				.set({ status: 'canceled', lastError: 'Request reopened.' })
				.where(
					and(
						eq(notificationDelivery.requestId, row.id),
						inArray(notificationDelivery.status, ['pending', 'sending'])
					)
				);
	}
	if (!previous) return;
	const fields = [
		'title',
		'description',
		'assigneeId',
		'completionNote',
		'internalNotes',
		'notifyOnDone',
	] as const;
	for (const field of fields) {
		if (previous[field] === row[field]) continue;
		const visible = !['internalNotes', 'notifyOnDone'].includes(field);
		await recordEvent(
			tx,
			row,
			actor,
			`${field}_changed`,
			{ [field]: { before: previous[field], after: row[field] } },
			visible
		);
	}
}

// Explicitly project customer-safe metadata; raw audit values can include internal notes.
export function publicRequestEvent(event: typeof requestEvent.$inferSelect) {
	return {
		id: event.id,
		kind: event.kind,
		source: event.source,
		fromStatus: event.fromStatus,
		toStatus: event.toStatus,
		createdAt: event.createdAt,
	};
}
