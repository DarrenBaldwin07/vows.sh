import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, eq, getDb, organization } from '@repo/db';
import { createApp } from '../src/app.js';
import type { Identity } from '../src/context.js';
import { workspaceSettingsInput } from '../src/validation.js';

test('internal domains normalize, clear explicitly, and reject invalid settings', () => {
	assert.deepEqual(
		workspaceSettingsInput.parse({ internalDomain: ' @TEMBO.IO ' }),
		{ internalDomain: 'tembo.io' }
	);
	assert.deepEqual(workspaceSettingsInput.parse({ internalDomain: null }), {
		internalDomain: null,
	});
	for (const internalDomain of [
		'',
		'https://tembo.io',
		'person@tembo.io',
		'*.tembo.io',
		'tembo..io',
	])
		assert.equal(
			workspaceSettingsInput.safeParse({ internalDomain }).success,
			false
		);
	assert.equal(workspaceSettingsInput.safeParse({}).success, false);
	assert.equal(
		workspaceSettingsInput.safeParse({
			internalDomain: null,
			portalSlug: 'override',
		}).success,
		false
	);
});

test(
	'internal domain access applies to all workspace portals and follows settings changes',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const db = getDb(),
			app = createApp(),
			key = randomUUID();
		const admin: Identity = {
			userId: `admin-${key}`,
			organizationId: `org-${key}`,
			role: 'org:admin',
			verifiedEmails: [],
		};
		const other = { ...admin, organizationId: `other-${key}` };
		const viewer: Identity = {
			userId: `viewer-${key}`,
			organizationId: null,
			role: null,
			verifiedEmails: ['person@TEMBO.IO'],
		};
		async function call(
			path: string,
			method = 'GET',
			body?: unknown,
			identity: Identity | undefined = admin
		) {
			return app.fetch(
				new Request(`http://test/api${path}`, {
					method,
					headers: {
						Origin: 'http://test',
						'Content-Type': 'application/json',
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
				{ identity }
			);
		}
		async function json(response: Response, status = 200) {
			const data = await response.json();
			assert.equal(response.status, status, JSON.stringify(data));
			return data;
		}
		async function makePortal(identity = admin) {
			const customer = await json(
				await call('/manage/customers', 'POST', { name: 'Customer' }, identity),
				201
			);
			const base = `/manage/customers/${customer.id}`;
			const link = await json(
				await call(`${base}/sharing`, 'POST', {}, identity)
			);
			return {
				base,
				paths: [link.path, link.legacyPath].map((path: string) =>
					path.replace('/share/', '/portal/')
				),
			};
		}
		try {
			const first = await makePortal();
			assert.deepEqual(await json(await call('/manage/settings')), {
				internalDomain: null,
			});
			assert.equal(
				(await call(first.paths[0]!, 'GET', undefined, viewer)).status,
				403
			);
			for (const method of ['GET', 'PATCH'])
				assert.equal(
					(
						await call(
							'/manage/settings',
							method,
							method === 'PATCH' ? { internalDomain: 'tembo.io' } : undefined,
							{ ...admin, role: 'org:member' }
						)
					).status,
					403
				);
			await json(
				await call('/manage/settings', 'PATCH', { internalDomain: '@TEMBO.IO' })
			);
			const second = await makePortal();
			const foreign = await makePortal(other);
			assert.deepEqual(
				await json(await call('/manage/settings', 'GET', undefined, other)),
				{ internalDomain: null }
			);
			for (const portal of [first, second]) {
				const sharing = await json(await call(`${portal.base}/sharing`));
				assert.equal(sharing.internalDomain, 'tembo.io');
				assert.deepEqual(sharing.access, []);
				for (const path of portal.paths) {
					await json(await call(path, 'GET', undefined, viewer));
					await json(
						await call(path, 'GET', undefined, {
							...viewer,
							userId: 'another-user',
						})
					);
					for (const verifiedEmails of [
						[],
						['person@eviltembo.io'],
						['person@sub.tembo.io'],
						['person@tembo.io.evil.com'],
					])
						assert.equal(
							(
								await call(path, 'GET', undefined, {
									...viewer,
									verifiedEmails,
								})
							).status,
							403
						);
				}
			}
			assert.equal(
				(await call(foreign.paths[0]!, 'GET', undefined, viewer)).status,
				403
			);
			assert.equal(
				(await app.fetch(new Request(`http://test/api${first.paths[0]}`), {}))
					.status,
				401
			);
			const created = await json(
				await call(
					`${first.paths[0]}/requests`,
					'POST',
					{ title: 'Internal request', description: '' },
					viewer
				),
				201
			);
			await json(
				await call(
					`${first.paths[0]}/requests/${created.id}/events`,
					'GET',
					undefined,
					viewer
				)
			);
			await json(
				await call('/manage/settings', 'PATCH', {
					internalDomain: 'new.example',
				})
			);
			assert.equal(
				(await call(first.paths[0]!, 'GET', undefined, viewer)).status,
				403
			);
			await json(
				await call(first.paths[0]!, 'GET', undefined, {
					...viewer,
					verifiedEmails: ['person@new.example'],
				})
			);
			await json(
				await call('/manage/settings', 'PATCH', { internalDomain: null })
			);
			assert.equal(
				(
					await call(first.paths[0]!, 'GET', undefined, {
						...viewer,
						verifiedEmails: ['person@new.example'],
					})
				).status,
				403
			);
			await json(
				await call(`${first.base}/access`, 'POST', {
					kind: 'domain',
					email: 'tembo.io',
				})
			);
			await json(await call(first.paths[0]!, 'GET', undefined, viewer));
			await json(
				await call('/manage/settings', 'PATCH', { internalDomain: 'tembo.io' })
			);
			await json(await call(first.base, 'PATCH', { archived: true }));
			assert.equal(
				(await call(first.paths[0]!, 'GET', undefined, viewer)).status,
				404
			);
			await json(await call(`${second.base}/sharing`, 'DELETE'));
			for (const path of second.paths)
				assert.equal((await call(path, 'GET', undefined, viewer)).status, 404);
		} finally {
			for (const identity of [admin, other])
				await db
					.delete(organization)
					.where(
						eq(organization.clerkOrganizationId, identity.organizationId!)
					);
			await closeDb();
		}
	}
);
