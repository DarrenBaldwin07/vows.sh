import { z } from 'zod';

export const statuses = [
	'todo',
	'in_progress',
	'in_review',
	'done',
	'canceled',
] as const;
export const customerInput = z.object({
	name: z.string().trim().min(1).max(160),
	domain: z.string().trim().max(253).nullable().optional(),
});
export const requestInput = z.object({
	title: z.string().trim().min(1).max(240),
	description: z.string().max(20000).default(''),
	internalNotes: z.string().max(20000).default(''),
	status: z.enum(statuses).default('todo'),
	assigneeId: z.string().max(200).nullable().default(null),
	completionNote: z.string().max(3000).default(''),
	notifyOnDone: z.boolean().nullable().default(null),
	slackUrl: z.string().max(2000).nullable().default(null),
});
export const accessInput = z.object({
	email: z.email().trim().toLowerCase().max(320),
});
export const statusInput = z.object({ status: z.enum(statuses) });

// Only Slack message permalinks, never arbitrary URLs or network fetches.
// For replies Slack supplies the root in thread_ts; otherwise ask for a root message link.
export function parseSlackLink(value: string) {
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		!/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) ||
		url.username ||
		url.password ||
		url.port
	)
		throw new Error('Use a Slack message permalink.');
	const match = /^\/archives\/([CG][A-Z0-9]+)\/p(\d{10,})(\d{6})$/.exec(
		url.pathname
	);
	if (!match) throw new Error('Copy the link to the original Slack message.');
	const messageTs = `${match[2]}.${match[3]}`;
	const threadTs = url.searchParams.get('thread_ts') ?? messageTs;
	if (!/^\d{10,}\.\d{6}$/.test(threadTs))
		throw new Error('The Slack thread timestamp is invalid.');
	return {
		channelId: match[1]!,
		messageTs,
		threadTs,
		permalink: url.toString(),
	};
}

export function shouldNotify(input: {
	previousStatus: string;
	status: string;
	enabled: boolean;
	hasThread: boolean;
	previouslyDelivered: boolean;
}) {
	return (
		input.previousStatus !== 'done' &&
		input.status === 'done' &&
		input.enabled &&
		input.hasThread &&
		!input.previouslyDelivered
	);
}
