import test from 'node:test';
import assert from 'node:assert/strict';
import {
	parseSlackLink,
	shouldNotify,
	requestInput,
	customerInput,
} from '../src/validation.js';
import { decrypt, encrypt, SlackError, slackCall } from '../src/slack.js';

test('Slack permalink preserves precision and resolves the parent thread', () => {
	assert.deepEqual(
		parseSlackLink(
			'https://acme.slack.com/archives/C123ABC/p1726854333123456?thread_ts=1726854000.000001'
		),
		{
			channelId: 'C123ABC',
			messageTs: '1726854333.123456',
			threadTs: '1726854000.000001',
			permalink:
				'https://acme.slack.com/archives/C123ABC/p1726854333123456?thread_ts=1726854000.000001',
		}
	);
	assert.equal(
		parseSlackLink('https://acme.slack.com/archives/C123/p1726854333000001')
			.threadTs,
		'1726854333.000001'
	);
});
test('Slack parser rejects lookalike domains, credentials, invalid timestamps and arbitrary URLs', () => {
	for (const url of [
		'http://acme.slack.com/archives/C123/p1726854333123456',
		'https://acme.slack.com.evil.test/archives/C123/p1726854333123456',
		'https://user@acme.slack.com/archives/C123/p1726854333123456',
		'https://acme.slack.com/archives/C123/p1726854333123456?thread_ts=oops',
		'https://localhost/admin',
	])
		assert.throws(() => parseSlackLink(url));
});
test('completion notification policy suppresses duplicates and disabled notifications', () => {
	const eligible = {
		previousStatus: 'in_progress',
		status: 'done',
		enabled: true,
		hasThread: true,
		previouslyDelivered: false,
	};
	assert.equal(shouldNotify(eligible), true);
	for (const override of [
		{ previousStatus: 'done' },
		{ status: 'in_review' },
		{ enabled: false },
		{ hasThread: false },
		{ previouslyDelivered: true },
	])
		assert.equal(shouldNotify({ ...eligible, ...override }), false);
});
test('request input rejects empty titles and invalid statuses', () => {
	assert.equal(requestInput.safeParse({ title: ' ' }).success, false);
	assert.equal(
		requestInput.safeParse({ title: 'Export', status: 'shipped' }).success,
		false
	);
	assert.equal(requestInput.parse({ title: ' Export ' }).title, 'Export');
});
test('credentials use authenticated encryption and reject tampering', () => {
	process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
		'base64'
	);
	const encoded = encrypt('test-secret');
	assert.equal(decrypt(encoded), 'test-secret');
	assert.ok(!encoded.includes('test-secret'));
	const parts = encoded.split('.');
	parts[2] = Buffer.from('tampered').toString('base64url');
	assert.throws(() => decrypt(parts.join('.')));
});
test('Slack rate limits are retryable, network failures are uncertain', async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = async () =>
			new Response('', { status: 429, headers: { 'retry-after': '17' } });
		await assert.rejects(
			slackCall('chat.postMessage', 'test', {}),
			(e: unknown) =>
				e instanceof SlackError && e.retryAfter === 17 && !e.uncertain
		);
		globalThis.fetch = async () => {
			throw new Error('timeout');
		};
		await assert.rejects(
			slackCall('chat.postMessage', 'test', {}),
			(e: unknown) => e instanceof SlackError && e.uncertain
		);
	} finally {
		globalThis.fetch = original;
	}
});

test('customer images accept bounded raster data and reject URLs, SVG, invalid bytes and oversized payloads', () => {
	const imageData =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=';
	assert.equal(
		customerInput.parse({ name: 'Acme', imageData }).imageData,
		imageData
	);
	assert.equal(
		customerInput.parse({ name: 'Acme', imageData: null }).imageData,
		null
	);
	for (const value of [
		'https://example.com/image.png',
		'data:image/svg+xml;base64,PHN2Zz4=',
		'data:image/png;base64,aGVsbG8=',
		'data:image/png;base64,' + 'A'.repeat(350000),
	]) {
		assert.equal(
			customerInput.safeParse({ name: 'Acme', imageData: value }).success,
			false
		);
	}
});
