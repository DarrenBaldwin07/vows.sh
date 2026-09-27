import {
	and,
	eq,
	isNull,
	sql,
	getDb,
	integration,
	request,
	requestLinearIssue,
	linearWebhook,
	customer,
	type Database,
} from '@repo/db';
import { linearStatus, type LinearIssue } from '../linear.js';
import {
	recordEvent,
	recordRequestChanges,
	type Transaction,
} from './request-events.js';

export async function lockLinear(tx: Transaction, integrationId: string) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${'linear:' + integrationId}, 0))`
	);
}
export async function applyLinearStatus(
	tx: Transaction,
	requestId: string,
	issue: Pick<LinearIssue, 'state'>
) {
	const [previous] = await tx
		.select()
		.from(request)
		.where(eq(request.id, requestId))
		.for('update');
	if (!previous) return;
	const [owner] = await tx
		.select()
		.from(customer)
		.where(eq(customer.id, previous.customerId));
	if (!owner || owner.archivedAt) return;
	const status = linearStatus(issue.state);
	if (previous.status === status) return;
	const [saved] = await tx
		.update(request)
		.set({
			status,
			updatedAt: new Date(
				Math.max(Date.now(), previous.updatedAt.getTime() + 1)
			),
			completedAt:
				status === 'done' ? (previous.completedAt ?? new Date()) : null,
		})
		.where(eq(request.id, requestId))
		.returning();
	await recordRequestChanges(tx, previous, saved!, {
		actorId: 'linear',
		source: 'linear',
	});
	await tx
		.update(customer)
		.set({ updatedAt: new Date() })
		.where(eq(customer.id, previous.customerId));
}
export async function processLinearWebhooks(
	db: Database = getDb(),
	limit = 50
) {
	let processed = 0;
	for (; processed < limit; processed++) {
		const found = await db.transaction(async (tx) => {
			const [job] = await tx
				.select()
				.from(linearWebhook)
				.where(isNull(linearWebhook.processedAt))
				.orderBy(linearWebhook.issueUpdatedAt, linearWebhook.receivedAt)
				.limit(1);
			if (!job) return false;
			await lockLinear(tx, job.integrationId);
			const [pending] = await tx
				.select()
				.from(linearWebhook)
				.where(
					and(eq(linearWebhook.id, job.id), isNull(linearWebhook.processedAt))
				)
				.for('update');
			if (!pending) return true;
			const [connection] = await tx
				.select()
				.from(integration)
				.where(
					and(
						eq(integration.id, job.integrationId),
						eq(integration.provider, 'linear'),
						isNull(integration.disconnectedAt)
					)
				);
			if (connection) {
				const links = await tx
					.select()
					.from(requestLinearIssue)
					.where(
						and(
							eq(requestLinearIssue.integrationId, connection.id),
							eq(requestLinearIssue.issueId, job.issueId)
						)
					)
					.orderBy(requestLinearIssue.requestId);
				for (const link of links) {
					if (job.issueUpdatedAt <= link.issueUpdatedAt) continue;
					if (job.action === 'remove') {
						const [row] = await tx
							.select()
							.from(request)
							.where(eq(request.id, link.requestId))
							.for('update');
						if (row)
							await recordEvent(
								tx,
								row,
								{ actorId: 'linear', source: 'linear' },
								'linear_unlinked',
								{ linearUrl: { before: link.url, after: null } }
							);
						await tx
							.delete(requestLinearIssue)
							.where(eq(requestLinearIssue.id, link.id));
					} else {
						// Non-status issue edits must not overwrite a manually changed request status.
						if (
							job.stateName !== link.stateName ||
							job.stateType !== link.stateType
						) {
							const [row] = await tx
								.select()
								.from(request)
								.where(eq(request.id, link.requestId))
								.for('update');
							if (row)
								await recordEvent(
									tx,
									row,
									{ actorId: 'linear', source: 'linear' },
									'linear_state_changed',
									{
										linearState: {
											before: link.stateName,
											after: job.stateName,
										},
									}
								);
							await applyLinearStatus(tx, link.requestId, {
								state: { name: job.stateName, type: job.stateType },
							});
						}
						await tx
							.update(requestLinearIssue)
							.set({
								stateName: job.stateName,
								stateType: job.stateType,
								issueUpdatedAt: job.issueUpdatedAt,
							})
							.where(eq(requestLinearIssue.id, link.id));
					}
				}
			}
			await tx
				.update(linearWebhook)
				.set({ processedAt: new Date() })
				.where(eq(linearWebhook.id, job.id));
			return true;
		});
		if (!found) break;
	}
	return { processed };
}
