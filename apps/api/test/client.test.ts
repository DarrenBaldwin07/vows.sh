import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../../web/lib/api.js';

test('API client preserves JSON errors and handles empty or non-JSON failures', async () => {
	const original = globalThis.fetch;
	try {
		for (const [body, status, message] of [
			['', 500, 'The request failed (500). Please try again.'],
			[
				'<html>Bad gateway</html>',
				502,
				'The request failed (502). Please try again.',
			],
			['{"error":"No access"}', 403, 'No access'],
			['null', 500, 'The request failed (500). Please try again.'],
			['{"error":{}}', 500, 'The request failed (500). Please try again.'],
			['', 401, 'Your session has expired. Please sign in again.'],
			['', 200, 'The server returned an empty response. Please try again.'],
			[
				'{"broken":',
				200,
				'The server returned an invalid response. Please try again.',
			],
		] as const) {
			globalThis.fetch = async () => new Response(body, { status });
			await assert.rejects(
				api('/manage/customers'),
				(error: unknown) =>
					error instanceof ApiError &&
					error.status === status &&
					error.message === message
			);
		}
		globalThis.fetch = async () => Response.json([{ id: 'customer' }]);
		assert.deepEqual(await api('/manage/customers'), [{ id: 'customer' }]);
		globalThis.fetch = async () => new Response(null, { status: 204 });
		assert.equal(await api<void>('/manage/customers'), undefined);
		const aborted = new DOMException('Aborted', 'AbortError');
		globalThis.fetch = async () => {
			throw aborted;
		};
		await assert.rejects(
			api('/manage/customers'),
			(error) => error === aborted
		);
	} finally {
		globalThis.fetch = original;
	}
});
