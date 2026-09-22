import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from 'node:crypto';

export function hashToken(value: string) {
	return createHash('sha256').update(value).digest('hex');
}
export function newToken() {
	return randomBytes(32).toString('base64url');
}
function encryptionKey() {
	const key = Buffer.from(
		process.env.INTEGRATION_ENCRYPTION_KEY ?? '',
		'base64'
	);
	if (key.length !== 32)
		throw new Error(
			'INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.'
		);
	return key;
}
export function encrypt(value: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
	const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), data]
		.map((b) => b.toString('base64url'))
		.join('.');
}
export function decrypt(value: string) {
	const [iv, tag, data] = value
		.split('.')
		.map((v) => Buffer.from(v, 'base64url'));
	if (!iv || !tag || !data) throw new Error('Invalid encrypted credential.');
	const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
	cipher.setAuthTag(tag);
	return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
export class SlackError extends Error {
	constructor(
		public code: string,
		public retryAfter = 0,
		public uncertain = false
	) {
		super(code);
	}
}
export async function slackCall<T>(
	method: string,
	token: string,
	body: Record<string, unknown>
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`https://slack.com/api/${method}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000),
		});
	} catch {
		throw new SlackError(
			'Delivery could not be confirmed. Check the thread before retrying.',
			0,
			true
		);
	}
	if (response.status === 429)
		throw new SlackError(
			'ratelimited',
			Number(response.headers.get('retry-after') ?? 60)
		);
	if (response.status >= 500)
		throw new SlackError(
			'Slack returned a server error; check the thread before retrying.',
			0,
			true
		);
	const result = (await response.json()) as T & { ok: boolean; error?: string };
	if (!result.ok) throw new SlackError(result.error ?? 'slack_error');
	return result;
}
export function slackConfigured() {
	return Boolean(
		process.env.SLACK_CLIENT_ID &&
		process.env.SLACK_CLIENT_SECRET &&
		process.env.INTEGRATION_ENCRYPTION_KEY &&
		process.env.APP_URL
	);
}
