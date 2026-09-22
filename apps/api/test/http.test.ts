import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { createClerkClient } from '@clerk/backend';
import { createHttpApp } from '../src/http.js';
import { sessionBindings } from '../src/clerk.js';
import { createApp } from '../src/app.js';

function environment(t: TestContext, key: string, value: string) {
	const previous = process.env[key];
	process.env[key] = value;
	t.after(() => {
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	});
}
const origin = 'https://vows.example.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
});
const client = createClerkClient({
	secretKey: 'sk_live_standalone_transport',
	publishableKey: `pk_live_${Buffer.from('clerk.example.test$').toString('base64')}`,
	jwtKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
	telemetry: { disabled: true },
});
function token(overrides: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' })
	).toString('base64url');
	const payload = Buffer.from(
		JSON.stringify({
			iss: 'https://clerk.example.test',
			sub: 'user_test',
			sid: 'sess_test',
			azp: origin,
			iat: now,
			nbf: now - 5,
			exp: now + 300,
			v: 2,
			o: { id: 'org_test', rol: 'admin', slg: 'test' },
			...overrides,
		})
	).toString('base64url');
	const unsigned = `${header}.${payload}`;
	return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

test('standalone HTTP server verifies Clerk sessions and refuses forged identities', async (t) => {
	environment(t, 'APP_URL', origin);
	let databaseAvailable = true;
	const http = createHttpApp({
		authenticateSession: (request) => sessionBindings(request, client),
		checkDatabase: async () => {
			if (!databaseAvailable) throw new Error('offline');
		},
		dispatch: async (request, bindings) =>
			Response.json({
				identity: bindings?.identity,
				url: request.url,
				forwardedHost: request.headers.get('x-forwarded-host'),
			}),
	});
	const server = serve({ fetch: http.fetch, hostname: '127.0.0.1', port: 0 });
	await once(server, 'listening');
	t.after(
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			)
	);
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const url = `http://127.0.0.1:${address.port}`;

	const health = await fetch(`${url}/health`);
	assert.equal(health.status, 200);
	assert.equal(health.headers.get('cache-control'), 'no-store');
	databaseAvailable = false;
	assert.equal((await fetch(`${url}/health`)).status, 503);

	for (const cookie of [
		'',
		'__session=forged',
		`__session=${token({ azp: 'https://evil.test' })}`,
	]) {
		const response = await fetch(`${url}/api/manage/customers`, {
			headers: {
				Cookie: `${cookie}; __client_uat=${Math.floor(Date.now() / 1000) - 10}`,
				'X-User-Id': 'user_admin',
				'X-Organization-Id': 'org_admin',
				'X-Forwarded-Host': 'evil.test',
				'X-Forwarded-Proto': 'http',
			},
		});
		assert.equal(response.status, 401, await response.text());
	}
	const response = await fetch(`${url}/api/manage/customers?q=hello`, {
		headers: {
			Cookie: `__session=${token()}; __client_uat=${Math.floor(Date.now() / 1000) - 10}`,
			'X-Forwarded-Host': 'evil.test',
		},
	});
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.deepEqual(body.identity, {
		userId: 'user_test',
		organizationId: 'org_test',
		role: 'org:admin',
		verifiedEmails: [],
	});
	assert.equal(body.url, `${origin}/api/manage/customers?q=hello`);
	assert.equal(body.forwardedHost, 'vows.example.test');
});

test('proxied mutations retain CSRF protection before database access', async (t) => {
	environment(t, 'APP_URL', origin);
	const app = createApp(() => {
		throw new Error('Database must not be reached');
	});
	const http = createHttpApp({
		authenticateSession: (request) => sessionBindings(request, client),
		dispatch: app.fetch,
	});
	const response = await http.request(
		'http://api.internal:3101/api/manage/customers',
		{
			method: 'POST',
			headers: {
				Cookie: `__session=${token()}; __client_uat=${Math.floor(Date.now() / 1000) - 10}`,
				Origin: 'https://evil.test',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name: 'Blocked' }),
		}
	);
	assert.equal(response.status, 403, await response.text());
});

test('MCP and OAuth discovery are served by the API', async (t) => {
	environment(t, 'APP_URL', origin);
	environment(t, 'CLERK_OAUTH_ISSUER', 'https://clerk.example.test');
	const http = createHttpApp();
	const metadata = await http.request(
		'/.well-known/oauth-protected-resource/mcp'
	);
	assert.equal(metadata.status, 200);
	assert.equal((await metadata.json()).resource, `${origin}/mcp`);
	assert.equal(metadata.headers.get('access-control-allow-origin'), '*');
	const options = await http.request(
		'/.well-known/oauth-protected-resource/mcp',
		{ method: 'OPTIONS' }
	);
	assert.equal(options.status, 204);
	const blocked = await http.request('/mcp', {
		method: 'POST',
		headers: { Origin: 'https://evil.test' },
	});
	assert.equal(blocked.status, 403);
});
