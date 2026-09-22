export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}
export async function api<T>(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		organizationId?: string | null;
		signal?: AbortSignal;
	} = {}
): Promise<T> {
	const response = await fetch(`/api${path}`, {
		method: options.method ?? 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		signal: options.signal,
		headers: {
			'Content-Type': 'application/json',
			...(options.organizationId
				? { 'X-Organization-Id': options.organizationId }
				: {}),
		},
		...(options.body !== undefined
			? { body: JSON.stringify(options.body) }
			: {}),
	});
	const body = await response.text();
	let result: unknown;
	try {
		result = body.trim() ? JSON.parse(body) : undefined;
	} catch {
		// Servers and proxies can return HTML or an empty body on failure.
		if (response.ok)
			throw new ApiError(
				'The server returned an invalid response. Please try again.',
				response.status
			);
	}
	if (!response.ok) {
		const message =
			typeof result === 'object' &&
			result !== null &&
			'error' in result &&
			typeof result.error === 'string'
				? result.error
				: undefined;
		throw new ApiError(
			message ||
				(response.status === 401
					? 'Your session has expired. Please sign in again.'
					: `The request failed (${response.status}). Please try again.`),
			response.status
		);
	}
	if (result === undefined && response.status !== 204)
		throw new ApiError(
			'The server returned an empty response. Please try again.',
			response.status
		);
	return result as T;
}
export const statuses = [
	'todo',
	'in_progress',
	'in_review',
	'done',
	'canceled',
] as const;
export type Status = (typeof statuses)[number];
export const statusLabels: Record<Status, string> = {
	todo: 'Todo',
	in_progress: 'In progress',
	in_review: 'In review',
	done: 'Done',
	canceled: 'Canceled',
};
export type Customer = {
	id: string;
	name: string;
	domain: string | null;
	archivedAt: string | null;
	updatedAt: string;
	openCount?: number;
	totalCount?: number;
};
export type VowRequest = {
	id: string;
	title: string;
	description: string;
	internalNotes: string;
	status: Status;
	assigneeId: string | null;
	completionNote: string;
	notifyOnDone: boolean | null;
	updatedAt: string;
	completedAt: string | null;
	slackUrl?: string | null;
};
export type RequestDetail = VowRequest & {
	events: {
		id: string;
		fromStatus: Status | null;
		toStatus: Status;
		createdAt: string;
	}[];
	deliveries: {
		id: string;
		status: string;
		sentAt: string | null;
		lastError: string | null;
		createdAt: string;
	}[];
};
export function dateLabel(value: string) {
	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
	}).format(new Date(value));
}
