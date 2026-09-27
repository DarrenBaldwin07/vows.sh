'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, Circle, Clock3, Pencil, Plus } from 'lucide-react';
import { api, statusLabels, type Status } from '@/lib/api';
import { Message } from './ui';

type Event = {
	id: string;
	kind: string;
	source: string;
	public?: boolean;
	fromStatus: Status | null;
	toStatus: Status;
	createdAt: string;
	changes?: Record<string, { before: unknown; after: unknown }> | null;
};
type Page = { events: Event[]; nextCursor: string | null };
const labels: Record<string, string> = {
	title_changed: 'Title updated',
	description_changed: 'Description updated',
	assigneeId_changed: 'Assignee updated',
	completionNote_changed: 'Completion note updated',
	internalNotes_changed: 'Internal notes updated',
	notifyOnDone_changed: 'Notification preference updated',
	slack_linked: 'Slack thread linked',
	slack_unlinked: 'Slack thread unlinked',
	linear_linked: 'Linear issue linked',
	linear_unlinked: 'Linear issue unlinked',
	linear_disconnected: 'Linear sync disconnected',
	linear_state_changed: 'Linear issue status changed',
	notification_requested: 'Slack update requested',
	notification_pending: 'Slack update queued',
	notification_sending: 'Sending Slack update',
	notification_sent: 'Update sent in Slack',
	notification_failed: 'Slack update failed',
	notification_uncertain: 'Slack delivery could not be confirmed',
	notification_canceled: 'Slack update canceled',
};
const fieldLabels: Record<string, string> = {
	title: 'Title',
	description: 'Description',
	internalNotes: 'Internal notes',
	assigneeId: 'Assignee',
	completionNote: 'Completion note',
	notifyOnDone: 'Completion notifications',
	slackUrl: 'Slack thread',
	linearUrl: 'Linear issue',
	linearState: 'Linear status',
	deliveryStatus: 'Delivery status',
};
const sources: Record<string, string> = {
	team: 'Team',
	customer: 'Customer',
	linear: 'Linear',
	system: 'System',
	agent: 'Agent',
};
function title(event: Event) {
	if (event.kind === 'created')
		return `Request created · ${statusLabels[event.toStatus]}`;
	if (event.kind === 'status_changed')
		return event.fromStatus
			? `${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}`
			: `Request created · ${statusLabels[event.toStatus]}`;
	return labels[event.kind] ?? 'Request updated';
}
function valueText(value: unknown) {
	if (value == null || value === '') return 'None';
	if (typeof value === 'boolean') return value ? 'On' : 'Off';
	return String(value);
}
export function RequestTimeline({
	path,
	organizationId,
	userId,
}: {
	path: string;
	organizationId?: string | null;
	userId?: string | null;
}) {
	const query = useInfiniteQuery({
		queryKey: ['request-events', path, organizationId, userId],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) =>
			api<Page>(
				`${path}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
				{ organizationId, signal }
			),
		getNextPageParam: (last) => last.nextCursor,
		refetchInterval: 15000,
	});
	const events = query.data?.pages.flatMap((page) => page.events) ?? [];
	return (
		<section className='request-timeline' aria-label='Request activity'>
			<div className='timeline-heading'>
				<h3>Activity</h3>
				<span>Newest first</span>
			</div>
			{query.isPending && (
				<output className='muted small'>Loading activity…</output>
			)}
			{query.error && <Message error>{query.error.message}</Message>}
			{!query.isPending && !query.error && !events.length && (
				<p className='muted small'>No activity recorded yet.</p>
			)}
			<ol className='timeline-list'>
				{events.map((event) => {
					const Icon =
						event.kind === 'created'
							? Plus
							: event.kind === 'status_changed'
								? event.toStatus === 'done'
									? Check
									: Circle
								: event.kind.startsWith('notification')
									? Clock3
									: Pencil;
					return (
						<li className='timeline-event' key={event.id}>
							<span
								className={`timeline-marker ${event.kind === 'status_changed' && event.toStatus === 'done' ? 'timeline-complete' : ''}`}>
								<Icon size={12} aria-hidden='true' />
							</span>
							<div className='timeline-content'>
								<p className='timeline-title'>
									{title(event)}
									{event.public === false && (
										<span className='timeline-private'>Team only</span>
									)}
								</p>
								<div className='timeline-meta'>
									<span>{sources[event.source] ?? 'Team'}</span>
									<span aria-hidden='true'>·</span>
									<time
										dateTime={event.createdAt}
										title={new Date(event.createdAt).toLocaleString()}>
										{new Date(event.createdAt).toLocaleString(undefined, {
											month: 'short',
											day: 'numeric',
											year: 'numeric',
											hour: 'numeric',
											minute: '2-digit',
										})}
									</time>
								</div>
								{event.changes && (
									<details className='timeline-changes'>
										<summary>View changes</summary>
										{Object.entries(event.changes).map(([field, change]) => (
											<div key={field}>
												<strong>{fieldLabels[field] ?? field}</strong>
												<p>
													<span>Before</span>
													{valueText(change.before)}
												</p>
												<p>
													<span>After</span>
													{valueText(change.after)}
												</p>
											</div>
										))}
									</details>
								)}
							</div>
						</li>
					);
				})}
			</ol>
			{query.hasNextPage && (
				<button
					className='button small-button'
					type='button'
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}>
					{query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
				</button>
			)}
		</section>
	);
}
