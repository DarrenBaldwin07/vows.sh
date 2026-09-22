import {
	and,
	eq,
	sql,
	getDb,
	request,
	customer,
	customerShareLink,
	integration,
	requestSlackThread,
	notificationDelivery,
	type Database,
} from '@repo/db';
import { decrypt, slackCall, SlackError } from './slack.js';

// Claim first, then deliver. An interrupted delivery becomes uncertain, never
// automatically retried: Slack may have accepted it before the process stopped.
export async function deliverNotifications(
	db: Database = getDb(),
	send = slackCall,
	limit = 20
) {
	await db
		.update(notificationDelivery)
		.set({
			status: 'uncertain',
			lastError:
				'Worker stopped before confirming delivery. Check the Slack thread before resending.',
		})
		.where(
			and(
				eq(notificationDelivery.status, 'sending'),
				sql`${notificationDelivery.lockedAt} < now() - interval '5 minutes'`
			)
		);
	let processed = 0;
	for (; processed < limit; processed++) {
		const claimed = await db.transaction(async (tx) => {
			const [job] = await tx
				.select()
				.from(notificationDelivery)
				.where(
					and(
						eq(notificationDelivery.status, 'pending'),
						sql`${notificationDelivery.nextAttemptAt} <= now()`
					)
				)
				.orderBy(notificationDelivery.nextAttemptAt)
				.limit(1)
				.for('update', { skipLocked: true });
			if (!job) return null;
			await tx
				.update(notificationDelivery)
				.set({
					status: 'sending',
					lockedAt: new Date(),
					attempts: job.attempts + 1,
				})
				.where(eq(notificationDelivery.id, job.id));
			return job;
		});
		if (!claimed) break;
		try {
			await db.transaction(async (tx) => {
				const [row] = await tx
					.select()
					.from(request)
					.where(eq(request.id, claimed.requestId))
					.for('update');
				const [current] = await tx
					.select()
					.from(notificationDelivery)
					.where(eq(notificationDelivery.id, claimed.id));
				if (current?.status !== 'sending') return;
				const [thread] = await tx
					.select()
					.from(requestSlackThread)
					.where(eq(requestSlackThread.id, claimed.threadId))
					.for('update');
				const [connection] = thread
					? await tx
							.select()
							.from(integration)
							.where(eq(integration.id, thread.integrationId))
							.for('update')
					: [];
				const [owner] = row
					? await tx
							.select()
							.from(customer)
							.where(eq(customer.id, row.customerId))
					: [];
				if (
					!row ||
					row.status !== 'done' ||
					!thread ||
					!connection?.encryptedCredentials ||
					connection.disconnectedAt ||
					!(row.notifyOnDone ?? connection.notifyOnDone) ||
					owner?.archivedAt
				) {
					await tx
						.update(notificationDelivery)
						.set({
							status: 'canceled',
							lastError:
								'Request, destination, or notification settings changed.',
						})
						.where(eq(notificationDelivery.id, claimed.id));
					return;
				}
				// Escape Slack control characters; untrusted titles must not ping a channel.
				const escape = (text: string) =>
					text
						.replaceAll('&', '&amp;')
						.replaceAll('<', '&lt;')
						.replaceAll('>', '&gt;');
				const [shareLink] = await tx
					.select()
					.from(customerShareLink)
					.where(
						and(
							eq(customerShareLink.customerId, row.customerId),
							sql`${customerShareLink.revokedAt} is null`
						)
					);
				const portalUrl =
					shareLink && process.env.APP_URL
						? `${process.env.APP_URL.replace(/\/$/, '')}/share/${shareLink.token}`
						: null;
				const text = `Completed: ${escape(row.title)}${row.completionNote ? `\n${escape(row.completionNote)}` : ''}${portalUrl ? `\nView your request: ${portalUrl}` : ''}`;
				const result = await send<{ ts: string }>(
					'chat.postMessage',
					decrypt(connection.encryptedCredentials),
					{
						channel: thread.channelId,
						thread_ts: thread.threadTs,
						text,
						mrkdwn: false,
						unfurl_links: false,
						unfurl_media: false,
					}
				);
				await tx
					.update(notificationDelivery)
					.set({
						status: 'sent',
						sentAt: new Date(),
						slackMessageTs: result.ts,
						lastError: null,
					})
					.where(eq(notificationDelivery.id, claimed.id));
			});
		} catch (error) {
			const slackError = error instanceof SlackError ? error : null;
			const retry = slackError?.retryAfter && claimed.attempts < 4;
			await db
				.update(notificationDelivery)
				.set({
					status: retry
						? 'pending'
						: slackError && !slackError.uncertain
							? 'failed'
							: 'uncertain',
					nextAttemptAt: new Date(
						Date.now() + (slackError?.retryAfter ?? 60) * 1000
					),
					lastError:
						slackError?.message ??
						'Delivery could not be confirmed. Check the thread before resending.',
				})
				.where(eq(notificationDelivery.id, claimed.id));
		}
	}
	return { processed };
}
