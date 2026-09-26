import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, eq, getDb, organization } from '@repo/db';
import { createApp } from '../src/app.js';
import type { Identity } from '../src/context.js';

test('portal mutations require authentication and a matching origin', async () => {
	const app = createApp(() => {
		throw new Error('Database must not be accessed');
	});
	for (const path of [
		'/portal/token/requests',
		'/portal/workspace/customer/requests',
	]) {
		const response = await app.fetch(
			new Request(`http://localhost/api${path}`, { method: 'POST' })
		);
		assert.equal(response.status, 401);
		const crossOrigin = await app.fetch(
			new Request(`http://localhost/api${path}`, {
				method: 'POST',
				headers: {
					Origin: 'https://other.test',
					'Content-Type': 'application/json',
				},
			}),
			{
				identity: {
					userId: 'viewer',
					organizationId: null,
					role: null,
					verifiedEmails: ['viewer@example.test'],
				},
			}
		);
		assert.equal(crossOrigin.status, 403);
	}
});

test(
	'portal customers can submit requests only to their authorized customer',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const app = createApp();
		const origin = 'http://localhost:3000';
		const key = randomUUID();
		const admin: Identity = {
			userId: `admin-${key}`,
			organizationId: `org-${key}`,
			role: 'org:admin',
			verifiedEmails: [],
		};
		const viewer: Identity = {
			userId: `viewer-${key}`,
			organizationId: null,
			role: null,
			verifiedEmails: ['viewer@example.test'],
		};
		async function call(
			path: string,
			method: string,
			body: unknown,
			who = admin
		) {
			return app.fetch(
				new Request(`${origin}/api${path}`, {
					method,
					headers: { Origin: origin, 'Content-Type': 'application/json' },
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
				{ identity: who }
			);
		}
		async function json(response: Response, status = 200) {
			const body = await response.json();
			assert.equal(response.status, status, JSON.stringify(body));
			return body;
		}
		try {
			const customer = await json(
				await call('/manage/customers', 'POST', { name: 'Portal customer' }),
				201
			);
			const other = await json(
				await call('/manage/customers', 'POST', { name: 'Other customer' }),
				201
			);
			const link = await json(
				await call(`/manage/customers/${customer.id}/sharing`, 'POST', {})
			);
			const otherLink = await json(
				await call(`/manage/customers/${other.id}/sharing`, 'POST', {})
			);
			const paths = [link.path, link.legacyPath].map((path: string) =>
				path.replace('/share/', '/portal/')
			);
			const body = {
				title: ' Customer request ',
				description: 'Please add a CSV export.',
			};
			for (const path of paths) {
				assert.equal(
					(await call(`${path}/requests`, 'POST', body, viewer)).status,
					403
				);
			}
			await json(
				await call(`/manage/customers/${customer.id}/access`, 'POST', {
					email: viewer.verifiedEmails[0],
				})
			);
			const sharing = await json(
				await call(`/manage/customers/${customer.id}/sharing`, 'GET', undefined)
			);
			const access = sharing.access[0];
			for (const path of paths) {
				for (const who of [
					{ ...viewer, verifiedEmails: [] },
					{ ...viewer, verifiedEmails: ['other@example.test'] },
				])
					assert.equal(
						(await call(`${path}/requests`, 'POST', body, who)).status,
						403
					);
				for (const invalid of [
					{ title: ' ' },
					{ ...body, status: 'done' },
					{ ...body, customerId: other.id },
					{ ...body, internalNotes: 'private' },
				]) {
					assert.equal(
						(await call(`${path}/requests`, 'POST', invalid, viewer)).status,
						400
					);
				}
				const created = await json(
					await call(`${path}/requests`, 'POST', body, viewer),
					201
				);
				assert.deepEqual(Object.keys(created), ['id']);
				const detail = await json(
					await call(`/manage/requests/${created.id}`, 'GET', undefined)
				);
				assert.equal(detail.customerId, customer.id);
				assert.equal(detail.createdBy, viewer.userId);
				assert.equal(detail.status, 'todo');
				assert.equal(detail.title, 'Customer request');
				assert.equal(detail.description, body.description);
				assert.equal(detail.internalNotes, '');
				assert.equal(detail.assigneeId, null);
				assert.equal(detail.events.length, 1);
				assert.equal(detail.events[0].actorId, viewer.userId);
				assert.equal(detail.events[0].fromStatus, null);
				assert.equal(detail.events[0].toStatus, 'todo');
				const portal = await json(await call(path, 'GET', undefined, viewer));
				assert.ok(
					portal.requests.some(
						(entry: { id: string }) => entry.id === created.id
					)
				);
				assert.ok(!JSON.stringify(portal).includes('internalNotes'));
			}
			assert.equal(
				(
					await call(
						`${otherLink.path.replace('/share/', '/portal/')}/requests`,
						'POST',
						body,
						viewer
					)
				).status,
				403
			);
			assert.equal(
				(
					await call(`${paths[0]}/requests`, 'POST', body, {
						...viewer,
						userId: 'different-user',
					})
				).status,
				403
			);
			assert.equal(
				(
					await call(
						`/manage/customers/${customer.id}/requests`,
						'POST',
						body,
						viewer
					)
				).status,
				403
			);
			await json(
				await call(
					`/manage/customers/${customer.id}/access/${access.id}`,
					'DELETE',
					{}
				)
			);
			for (const path of paths)
				assert.equal(
					(await call(`${path}/requests`, 'POST', body, viewer)).status,
					403
				);
			await json(
				await call(`/manage/customers/${customer.id}/access`, 'POST', {
					email: viewer.verifiedEmails[0],
				})
			);
			await json(
				await call(`/manage/customers/${customer.id}`, 'PATCH', {
					archived: true,
				})
			);
			for (const path of paths)
				assert.equal(
					(await call(`${path}/requests`, 'POST', body, viewer)).status,
					404
				);
			await json(
				await call(`/manage/customers/${customer.id}`, 'PATCH', {
					archived: false,
				})
			);
			await json(
				await call(`/manage/customers/${customer.id}/sharing`, 'POST', {})
			);
			for (const path of paths)
				assert.equal(
					(await call(`${path}/requests`, 'POST', body, viewer)).status,
					404
				);
		} finally {
			await getDb()
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, admin.organizationId!));
			await closeDb();
		}
	}
);
