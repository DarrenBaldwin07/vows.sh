import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { decrypt } from './slack.js';

const credentialsInput = z.object({
	apiKey: z.string().min(1),
	webhookSecret: z.string().nullable(),
});
export function linearCredentials(encrypted: string) {
	return credentialsInput.parse(JSON.parse(decrypt(encrypted)));
}
export function parseLinearLink(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new HTTPException(400, { message: 'Paste a Linear issue URL.' });
	}
	const match = /^\/([^/]+)\/issue\/([a-z][a-z0-9]*-\d+)(?:\/[^/]*)?\/?$/i.exec(
		url.pathname
	);
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'linear.app' ||
		url.port ||
		url.username ||
		url.password ||
		!match
	)
		throw new HTTPException(400, {
			message:
				'Use a Linear issue URL such as https://linear.app/team/issue/ENG-123/title.',
		});
	return { workspace: match[1]!, identifier: match[2]!.toUpperCase() };
}
export function linearStatus(state: { type: string; name: string }) {
	switch (state.type) {
		case 'triage':
		case 'backlog':
		case 'unstarted':
			return 'todo' as const;
		case 'started':
			return /^(?:in[ -])?review$/i.test(state.name.trim())
				? ('in_review' as const)
				: ('in_progress' as const);
		case 'completed':
			return 'done' as const;
		case 'canceled':
			return 'canceled' as const;
		default:
			throw new HTTPException(400, {
				message: 'This Linear workflow status is not supported.',
			});
	}
}
export async function linearQuery<T>(
	apiKey: string,
	query: string,
	variables: Record<string, unknown> = {}
): Promise<T> {
	let response: Response;
	try {
		response = await fetch('https://api.linear.app/graphql', {
			method: 'POST',
			headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(10000),
		});
	} catch {
		throw new HTTPException(502, {
			message: 'Linear is unavailable. Please try again.',
		});
	}
	const result = (await response.json().catch(() => null)) as {
		data?: T;
		errors?: unknown[];
	} | null;
	if (!response.ok || result?.errors?.length || !result?.data)
		throw new HTTPException(400, {
			message:
				'Could not read Linear. Check the API key, workspace, and issue permissions.',
		});
	return result.data;
}
export const linearOrganizationInput = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	urlKey: z.string().min(1),
});
export const linearIssueInput = z.object({
	id: z.string().min(1),
	identifier: z.string().min(1),
	url: z.string().url(),
	updatedAt: z.iso.datetime(),
	state: z.object({ name: z.string().max(200), type: z.string().max(50) }),
});
export type LinearIssue = z.infer<typeof linearIssueInput>;
export async function readLinearIssue(
	apiKey: string,
	url: string,
	externalAccountId: string
) {
	const parsed = parseLinearLink(url);
	const data = await linearQuery<{ organization: unknown; issue: unknown }>(
		apiKey,
		'query VowsIssue($id: String!) { organization { id name urlKey } issue(id: $id) { id identifier url updatedAt state { name type } } }',
		{ id: parsed.identifier }
	);
	const organization = linearOrganizationInput.parse(data.organization);
	if (
		organization.id !== externalAccountId ||
		organization.urlKey.toLowerCase() !== parsed.workspace.toLowerCase()
	)
		throw new HTTPException(400, {
			message: 'Choose an issue in the connected Linear workspace.',
		});
	const issue = linearIssueInput.parse(data.issue);
	parseLinearLink(issue.url);
	linearStatus(issue.state);
	return issue;
}
export function validLinearSignature(
	raw: Uint8Array,
	signature: string | undefined,
	secret: string
) {
	if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
	return timingSafeEqual(
		createHmac('sha256', secret).update(raw).digest(),
		Buffer.from(signature, 'hex')
	);
}
