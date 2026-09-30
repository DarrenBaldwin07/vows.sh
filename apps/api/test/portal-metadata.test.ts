import test from 'node:test';
import assert from 'node:assert/strict';
import { portalMetadata } from '../../web/lib/portal-metadata.js';

test('portal metadata uses the public uploaded-logo URL for readable and legacy links', async (t) => {
	const previous = {
		API_URL: process.env.API_URL,
		APP_URL: process.env.APP_URL,
	};
	process.env.API_URL = 'http://api.internal:3101';
	process.env.APP_URL = 'https://vows.example.test';
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
	let hasImage = true;
	let status = 200;
	const requests: string[] = [];
	t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
		requests.push(url.href);
		assert.equal(options.cache, 'no-store');
		return Response.json({ name: 'Wave', hasImage }, { status });
	});
	for (const segments of [['acme', 'wave'], ['legacy-token']]) {
		const metadata = await portalMetadata(segments);
		const images = [
			{
				url: `https://vows.example.test/api/portal-preview/${segments.join('/')}?image=1`,
				alt: 'Wave logo',
			},
		];
		assert.equal(
			requests.at(-1),
			`http://api.internal:3101/api/portal-preview/${segments.join('/')}`
		);
		assert.equal(metadata.openGraph?.title, 'Wave · Customer portal');
		assert.deepEqual(metadata.openGraph?.images, images);
		assert.deepEqual(metadata.twitter?.images, images);
	}
	hasImage = false;
	assert.deepEqual(
		(await portalMetadata(['acme', 'wave'])).openGraph?.images,
		[]
	);
	status = 404;
	assert.deepEqual(await portalMetadata(['missing']), {
		title: 'Customer portal',
	});
});
