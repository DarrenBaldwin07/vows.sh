import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import {
	readableSlug,
	portalAddressInput,
} from '../src/services/portal-links.js';
import { getDb, closeDb, organization, customerShareLink, eq } from '@repo/db';
import type { Identity } from '../src/context.js';

test('portal slugs normalize names and reject ambiguous URL segments', () => {
	assert.equal(readableSlug(' Café & Wave! ', 'customer'), 'cafe-wave');
	assert.equal(readableSlug('🌊', 'customer'), 'customer');
	assert.equal(readableSlug('a'.repeat(200), 'customer').length, 50);
	assert.deepEqual(
		portalAddressInput.parse({ workspaceSlug: 'ACME', customerSlug: 'wave' }),
		{ workspaceSlug: 'acme', customerSlug: 'wave' }
	);
	for (const value of [
		'../wave',
		'wave/name',
		'wave?key=x',
		'-wave',
		'wave-',
		'wave--team',
		'',
	]) {
		assert.equal(
			portalAddressInput.safeParse({
				workspaceSlug: 'acme',
				customerSlug: value,
			}).success,
			false
		);
	}
});

test(
	'readable portal links preserve authorization, legacy URLs, aliases and revocation',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const db = getDb(),
			app = createApp();
		const suffix = randomUUID().slice(0, 8);
		const admin: Identity = {
			userId: `admin-${suffix}`,
			organizationId: `org-${suffix}`,
			role: 'org:admin',
			verifiedEmails: [],
		};
		const other = {
			...admin,
			userId: `other-${suffix}`,
			organizationId: `other-org-${suffix}`,
		};
		const viewer: Identity = {
			userId: `viewer-${suffix}`,
			organizationId: null,
			role: null,
			verifiedEmails: [`viewer-${suffix}@example.test`],
		};
		async function call(
			path: string,
			method = 'GET',
			body?: unknown,
			who = admin
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
				{
					identity: who,
					workspaceBranding: async () => ({
						name: `Portal ${suffix}`,
						imageUrl: '',
						hasImage: false,
					}),
				}
			);
		}
		async function ok<T>(response: Response, status = 200): Promise<T> {
			const data = await response.json();
			assert.equal(response.status, status, JSON.stringify(data));
			return data as T;
		}
		const portal = (path: string, who = viewer) =>
			call(path.replace('/share/', '/portal/'), 'GET', undefined, who);
		try {
			const a = await ok<{ id: string }>(
				await call('/manage/customers', 'POST', { name: 'Wave' }),
				201
			);
			const b = await ok<{ id: string }>(
				await call('/manage/customers', 'POST', { name: 'Wave' }),
				201
			);
			const foreign = await ok<{ id: string }>(
				await call('/manage/customers', 'POST', { name: 'Wave' }, other),
				201
			);
			const [first, secondWorkspace] = await Promise.all([
				call(`/manage/customers/${a.id}/sharing`, 'POST', {}).then((r) =>
					ok<{ path: string; legacyPath: string }>(r)
				),
				call(`/manage/customers/${foreign.id}/sharing`, 'POST', {}, other).then(
					(r) => ok<{ path: string }>(r)
				),
			]);
			assert.match(first.path, /^\/share\/portal-[a-z0-9-]+\/wave$/);
			assert.notEqual(
				first.path.split('/')[2],
				secondWorkspace.path.split('/')[2]
			);
			const second = await ok<{ path: string }>(
				await call(`/manage/customers/${b.id}/sharing`, 'POST', {})
			);
			assert.equal(second.path, `${first.path}-2`);
			assert.equal((await portal(first.path)).status, 403);
			assert.equal((await portal(first.legacyPath)).status, 403);
			assert.equal(
				(
					await call(
						`/manage/customers/${a.id}/sharing`,
						'GET',
						undefined,
						other
					)
				).status,
				404
			);
			assert.equal(
				(
					await call(
						`/manage/customers/${a.id}/sharing`,
						'PATCH',
						{ workspaceSlug: 'test', customerSlug: 'wave' },
						{ ...admin, role: 'org:member' }
					)
				).status,
				403
			);
			await ok(
				await call(`/manage/customers/${a.id}/access`, 'POST', {
					email: viewer.verifiedEmails[0],
				})
			);
			assert.equal((await portal(first.path)).status, 200);
			assert.equal((await portal(first.legacyPath)).status, 200);
			await ok(
				await call(`/manage/customers/${a.id}`, 'PATCH', {
					name: 'Wave renamed',
				})
			);
			const sharing = await ok<{ link: { path: string } }>(
				await call(`/manage/customers/${a.id}/sharing`)
			);
			assert.equal(sharing.link.path, first.path);
			const changed = await ok<{ path: string }>(
				await call(`/manage/customers/${a.id}/sharing`, 'PATCH', {
					workspaceSlug: `new-${suffix}`,
					customerSlug: 'wave-team',
				})
			);
			assert.equal(changed.path, `/share/new-${suffix}/wave-team`);
			assert.equal((await portal(first.path)).status, 200);
			assert.equal((await portal(first.legacyPath)).status, 200);
			assert.equal((await portal(changed.path)).status, 200);
			assert.equal(
				(
					await call(
						`/manage/customers/${foreign.id}/sharing`,
						'PATCH',
						{
							workspaceSlug: first.path.split('/')[2],
							customerSlug: 'takeover',
						},
						other
					)
				).status,
				409
			);
			assert.equal(
				(
					await call(`/manage/customers/${a.id}/sharing`, 'PATCH', {
						workspaceSlug: second.path.split('/')[2],
						customerSlug: 'wave-2',
					})
				).status,
				409
			);
			const rotated = await ok<{ path: string; legacyPath: string }>(
				await call(`/manage/customers/${a.id}/sharing`, 'POST', {})
			);
			for (const path of [first.path, first.legacyPath, changed.path])
				assert.equal((await portal(path)).status, 404);
			assert.equal((await portal(rotated.path)).status, 200);
			await ok(
				await call(`/manage/customers/${a.id}`, 'PATCH', { archived: true })
			);
			assert.equal((await portal(rotated.path)).status, 404);
			await ok(
				await call(`/manage/customers/${a.id}`, 'PATCH', { archived: false })
			);
			await ok(await call(`/manage/customers/${a.id}/sharing`, 'DELETE'));
			assert.equal((await portal(rotated.path)).status, 404);
			assert.equal((await portal(rotated.legacyPath)).status, 404);
			const enabled = await ok<{ path: string }>(
				await call(`/manage/customers/${a.id}/sharing`, 'POST', {})
			);
			assert.notEqual(enabled.path, rotated.path);
			assert.equal((await portal(rotated.path)).status, 404);
			assert.equal((await portal(enabled.path)).status, 200);
			// Upgrade a pre-migration token without rotating it or dropping customer access.
			const legacyCustomer = await ok<{ id: string }>(
				await call('/manage/customers', 'POST', { name: 'Legacy' }),
				201
			);
			const legacyToken = randomUUID();
			await db
				.insert(customerShareLink)
				.values({ customerId: legacyCustomer.id, token: legacyToken });
			await ok(
				await call(`/manage/customers/${legacyCustomer.id}/access`, 'POST', {
					email: viewer.verifiedEmails[0],
				})
			);
			const upgraded = await ok<{ link: { token: string; path: string } }>(
				await call(`/manage/customers/${legacyCustomer.id}/sharing`)
			);
			assert.equal(upgraded.link.token, legacyToken);
			assert.equal((await portal(`/share/${legacyToken}`)).status, 200);
			assert.equal((await portal(upgraded.link.path)).status, 200);
		} finally {
			for (const orgId of [admin.organizationId!, other.organizationId!])
				await db
					.delete(organization)
					.where(eq(organization.clerkOrganizationId, orgId));
			await closeDb();
		}
	}
);
