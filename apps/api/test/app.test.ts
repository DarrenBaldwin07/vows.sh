import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import {
	getDb,
	closeDb,
	organization,
	request,
	integration,
	notificationDelivery,
	and,
	eq,
	sql,
} from '@repo/db';
import type { Identity } from '../src/context.js';
import { encrypt, SlackError } from '../src/slack.js';
import { deliverNotifications } from '../src/worker.js';

const app = createApp();
const origin = 'http://localhost:3000';
const key = randomUUID();
const admin: Identity = {
	userId: `admin-${key}`,
	organizationId: `org-${key}`,
	role: 'org:admin',
	verifiedEmails: [],
};
const other: Identity = { ...admin, organizationId: `other-${key}` };
const viewer: Identity = {
	userId: `viewer-${key}`,
	organizationId: null,
	role: null,
	verifiedEmails: ['customer@acme.test'],
};
async function call(
	path: string,
	method = 'GET',
	body?: unknown,
	who: Identity | undefined = admin,
	headers: Record<string, string> = {}
) {
	return app.fetch(
		new Request(`${origin}/api${path}`, {
			method,
			headers: {
				Origin: origin,
				'Content-Type': 'application/json',
				...headers,
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		}),
		{
			identity: who,
			members: async () => [
				{ id: admin.userId, name: 'Admin', email: 'admin@example.test' },
			],
		}
	);
}
async function json<T>(response: Response, expected = 200): Promise<T> {
	const body = await response.json();
	assert.equal(response.status, expected, JSON.stringify(body));
	return body as T;
}

test('unauthenticated requests are rejected before database access', async () => {
	const response = await app.fetch(
		new Request(`${origin}/api/manage/customers`)
	);
	assert.equal(response.status, 401);
});
test('cross-origin mutations are rejected before database access', async () => {
	const response = await call(
		'/manage/customers',
		'POST',
		{ name: 'test' },
		admin,
		{ Origin: 'https://evil.test' }
	);
	assert.equal(response.status, 403);
});

test(
	'Postgres integration: organization boundaries, sharing and delivery lifecycle',
	{ skip: !process.env.TEST_DATABASE_URL },
	async (t) => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
			'base64'
		);
		process.env.APP_URL = origin;
		const db = getDb();
		const a = await json<{ id: string }>(
			await call('/manage/customers', 'POST', {
				name: 'Acme',
				domain: 'acme.test',
			}),
			201
		);
		const b = await json<{ id: string }>(
			await call('/manage/customers', 'POST', { name: 'Other' }, other),
			201
		);
		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.clerkOrganizationId, admin.organizationId!));
		const body = {
			title: 'CSV export',
			description: 'Export your data',
			internalNotes: 'PRIVATE INTERNAL NOTE',
			completionNote: 'Your export is ready.',
		};
		const vow = await json<{ id: string }>(
			await call(`/manage/customers/${a.id}/requests`, 'POST', body),
			201
		);
		await t.test(
			'customer list counts match requests and distinguish open from closed',
			async () => {
				const empty = await json<{ id: string }>(
					await call('/manage/customers', 'POST', { name: 'No requests' }),
					201
				);
				async function counts(id: string) {
					const rows = await json<
						{ id: string; openCount: number; totalCount: number }[]
					>(await call('/manage/customers'));
					const row = rows.find((entry) => entry.id === id)!;
					return { open: row.openCount, total: row.totalCount };
				}
				assert.deepEqual(await counts(a.id), { open: 1, total: 1 });
				assert.deepEqual(await counts(empty.id), { open: 0, total: 0 });
				const mixed = await json<{ id: string }>(
					await call('/manage/customers', 'POST', { name: 'Mixed statuses' }),
					201
				);
				for (const status of [
					'todo',
					'in_progress',
					'in_review',
					'done',
					'canceled',
				]) {
					await json(
						await call(`/manage/customers/${mixed.id}/requests`, 'POST', {
							title: status,
							status,
						}),
						201
					);
				}
				assert.deepEqual(await counts(mixed.id), { open: 3, total: 5 });
				assert.deepEqual(await counts(a.id), { open: 1, total: 1 });
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'done',
					})
				);
				assert.deepEqual(await counts(a.id), { open: 0, total: 1 });
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'todo',
					})
				);
				assert.deepEqual(await counts(a.id), { open: 1, total: 1 });
			}
		);
		await t.test(
			'workspace search scopes customers and requests, filters status, and treats wildcard input literally',
			async () => {
				type Results = {
					customers: { id: string }[];
					requests: { id: string; customerId: string; status: string }[];
					moreRequests: boolean;
				};
				const search = async (params: Record<string, string>, who = admin) =>
					json<Results>(
						await call(
							`/manage/search?${new URLSearchParams(params)}`,
							'GET',
							undefined,
							who
						)
					);
				const byDomain = await search({ q: 'ACME.TEST' });
				assert.ok(byDomain.customers.some((row) => row.id === a.id));
				assert.ok(byDomain.requests.some((row) => row.id === vow.id));
				assert.ok(
					(await search({ q: 'csv export' })).requests.some(
						(row) => row.id === vow.id
					)
				);
				assert.ok(
					(await search({ q: 'PRIVATE INTERNAL' })).requests.some(
						(row) => row.id === vow.id
					)
				);
				assert.deepEqual(
					(await search({ q: 'PRIVATE INTERNAL' }, other)).requests,
					[]
				);
				assert.deepEqual(
					(await search({ customerId: a.id, status: 'done' })).requests,
					[]
				);
				assert.deepEqual(
					(await search({ customerId: a.id, status: 'todo' })).requests.map(
						(row) => row.id
					),
					[vow.id]
				);
				assert.equal(
					(
						await call(
							`/manage/search?customerId=${a.id}`,
							'GET',
							undefined,
							other
						)
					).status,
					404
				);
				assert.equal((await call('/manage/search?customerId=bad')).status, 400);
				assert.equal((await call('/manage/search?status=bad')).status, 400);
				assert.equal(
					(await call(`/manage/search?q=${'x'.repeat(201)}`)).status,
					400
				);
				assert.equal(
					(await app.fetch(new Request(`${origin}/api/manage/search?q=Acme`)))
						.status,
					401
				);
				const owner = await json<{ id: string }>(
					await call('/manage/customers', 'POST', { name: 'Search fixtures' }),
					201
				);
				await db
					.insert(request)
					.values(
						Array.from({ length: 32 }, (_, index) => ({
							customerId: owner.id,
							organizationId: org!.id,
							title:
								index === 0 ? '100% literal_test' : `Search fixture ${index}`,
							createdBy: admin.userId,
						}))
					);
				const limited = await search({ customerId: owner.id });
				assert.equal(limited.requests.length, 30);
				assert.equal(limited.moreRequests, true);
				assert.ok(limited.requests.every((row) => row.customerId === owner.id));
				assert.equal(
					(await search({ customerId: owner.id, q: '%' })).requests.length,
					1
				);
				assert.equal(
					(await search({ customerId: owner.id, q: '_' })).requests.length,
					1
				);
				assert.deepEqual(
					(await search({ customerId: owner.id, q: 'does-not-exist' }))
						.requests,
					[]
				);
				await json(
					await call(`/manage/customers/${owner.id}`, 'PATCH', {
						archived: true,
					})
				);
				assert.ok(
					(await search({ q: 'Search fixtures' })).customers.some(
						(row) => row.id === owner.id
					)
				);
			}
		);
		await t.test(
			'another organization cannot read, edit, share, or attach requests',
			async () => {
				for (const [path, method, data] of [
					[`/manage/customers/${a.id}`, 'GET', undefined],
					[`/manage/customers/${a.id}`, 'PATCH', { name: 'Stolen' }],
					[`/manage/customers/${a.id}/sharing`, 'POST', {}],
					[`/manage/customers/${a.id}/requests`, 'POST', body],
					[`/manage/requests/${vow.id}`, 'GET', undefined],
					[`/manage/requests/${vow.id}/status`, 'PATCH', { status: 'done' }],
				] as const)
					assert.equal((await call(path, method, data, other)).status, 404);
				const list = await json<{ id: string }[]>(
					await call('/manage/customers', 'GET', undefined, other)
				);
				assert.deepEqual(
					list.map((c) => c.id),
					[b.id]
				);
				assert.equal(
					(
						await call('/manage/customers', 'GET', undefined, admin, {
							'X-Organization-Id': other.organizationId!,
						})
					).status,
					409
				);
				await assert.rejects(
					db.insert(request).values({
						organizationId: org!.id,
						customerId: b.id,
						title: 'Invalid tenant link',
						createdBy: admin.userId,
					})
				);
			}
		);
		await t.test(
			'members can track requests but cannot manage sharing or integrations',
			async () => {
				const member = { ...admin, role: 'org:member' };
				assert.equal(
					(await call(`/manage/customers/${a.id}/sharing`, 'POST', {}, member))
						.status,
					403
				);
				assert.equal(
					(
						await call(
							'/manage/integrations/slack',
							'PATCH',
							{ notifyOnDone: true },
							member
						)
					).status,
					403
				);
				assert.equal(
					(
						await call(
							`/manage/requests/${vow.id}/status`,
							'PATCH',
							{ status: 'in_progress' },
							member
						)
					).status,
					200
				);
			}
		);
		let token = '';
		await t.test(
			'portal requires an invited verified email and returns only public fields',
			async () => {
				const link = await json<{ path: string }>(
					await call(`/manage/customers/${a.id}/sharing`, 'POST', {})
				);
				token = link.path.split('/').at(-1)!;
				assert.equal(
					(await call(`/portal/${token}`, 'GET', undefined, viewer)).status,
					403
				);
				await json(
					await call(`/manage/customers/${a.id}/access`, 'POST', {
						email: 'customer@acme.test',
					})
				);
				assert.equal(
					(
						await call(`/portal/${token}`, 'GET', undefined, {
							...viewer,
							verifiedEmails: [],
						})
					).status,
					403
				);
				const portal = await json<{
					customer: { name: string };
					requests: Record<string, unknown>[];
				}>(await call(`/portal/${token}`, 'GET', undefined, viewer));
				assert.equal(portal.customer.name, 'Acme');
				assert.equal(portal.requests.length, 1);
				assert.ok(!('internalNotes' in portal.requests[0]!));
				assert.ok(!('organizationId' in portal.requests[0]!));
				assert.ok(!JSON.stringify(portal).includes('PRIVATE INTERNAL NOTE'));
				assert.equal(
					(await call(`/manage/customers/${a.id}`, 'GET', undefined, viewer))
						.status,
					403
				);
			}
		);
		await t.test(
			'revocation, link rotation and archiving take effect on the next read',
			async () => {
				const sharing = await json<{ access: { id: string }[] }>(
					await call(`/manage/customers/${a.id}/sharing`)
				);
				await json(
					await call(
						`/manage/customers/${a.id}/access/${sharing.access[0]!.id}`,
						'DELETE',
						{}
					)
				);
				assert.equal(
					(await call(`/portal/${token}`, 'GET', undefined, viewer)).status,
					403
				);
				await json(
					await call(`/manage/customers/${a.id}/access`, 'POST', {
						email: 'customer@acme.test',
					})
				);
				const link = await json<{ path: string }>(
					await call(`/manage/customers/${a.id}/sharing`, 'POST', {})
				);
				assert.equal(
					(await call(`/portal/${token}`, 'GET', undefined, viewer)).status,
					404
				);
				token = link.path.split('/').at(-1)!;
				await json(
					await call(`/manage/customers/${a.id}`, 'PATCH', { archived: true })
				);
				assert.equal(
					(await call(`/portal/${token}`, 'GET', undefined, viewer)).status,
					404
				);
				assert.equal(
					(await call(`/manage/customers/${a.id}/requests`, 'POST', body))
						.status,
					400
				);
				await json(
					await call(`/manage/customers/${a.id}`, 'PATCH', { archived: false })
				);
				assert.equal(
					(await call(`/portal/${token}`, 'GET', undefined, viewer)).status,
					200
				);
			}
		);
		const [connection] = await db
			.insert(integration)
			.values({
				organizationId: org!.id,
				provider: 'slack',
				externalAccountId: 'T123',
				externalAccountName: 'Test Slack',
				encryptedCredentials: encrypt('test-token'),
				notifyOnDone: true,
			})
			.returning();
		const slackBody = {
			...body,
			slackUrl:
				'https://acme.slack.com/archives/C123/p1726854333123456?thread_ts=1726854000.000001',
		};
		await json(
			await call(`/manage/requests/${vow.id}`, 'PUT', {
				...slackBody,
				status: 'in_progress',
			})
		);
		const deliveries = () =>
			db
				.select()
				.from(notificationDelivery)
				.where(eq(notificationDelivery.requestId, vow.id));
		await t.test(
			'concurrent completion writes enqueue a single notification',
			async () => {
				const responses = await Promise.all([
					call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'done',
					}),
					call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'done',
					}),
				]);
				for (const response of responses) assert.equal(response.status, 200);
				assert.equal((await deliveries()).length, 1);
				await json(
					await call(`/manage/requests/${vow.id}`, 'PUT', {
						...slackBody,
						title: 'CSV export ready',
						status: 'done',
					})
				);
				assert.equal((await deliveries())[0]!.status, 'pending');
			}
		);
		let sent = 0;
		const sender = async <T>(
			_method: string,
			authToken: string,
			payload: Record<string, unknown>
		): Promise<T> => {
			sent++;
			assert.equal(authToken, 'test-token');
			assert.equal(payload.channel, 'C123');
			assert.equal(payload.thread_ts, '1726854000.000001');
			assert.ok(String(payload.text).includes('Your export is ready.'));
			assert.ok(String(payload.text).includes(`/share/${token}`));
			assert.ok(!String(payload.text).includes('PRIVATE INTERNAL NOTE'));
			return { ts: '1726855000.000001' } as T;
		};
		await t.test(
			'worker sends to the original thread, and repeat saves or completions do not resend',
			async () => {
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
				assert.equal((await deliveries())[0]!.status, 'sent');
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'done',
					})
				);
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'todo',
					})
				);
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'done',
					})
				);
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
			}
		);
		await t.test(
			'explicit resend, rate-limit retries and uncertain delivery handling',
			async () => {
				await json(await call(`/manage/requests/${vow.id}/notify`, 'POST', {}));
				assert.equal(
					(await call(`/manage/requests/${vow.id}/notify`, 'POST', {})).status,
					409
				);
				await deliverNotifications(db, async () => {
					throw new SlackError('ratelimited', 30);
				});
				const queued = (await deliveries()).find(
					(d) => d.status === 'pending'
				)!;
				assert.equal(queued.attempts, 1);
				assert.ok(queued.nextAttemptAt > new Date());
				await db
					.update(notificationDelivery)
					.set({ nextAttemptAt: new Date(0) })
					.where(eq(notificationDelivery.id, queued.id));
				await deliverNotifications(db, async () => {
					throw new SlackError('timeout', 0, true);
				});
				assert.equal(
					(await deliveries()).find((d) => d.id === queued.id)!.status,
					'uncertain'
				);
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
			}
		);
		await t.test(
			'worker rechecks settings and request status before sending',
			async () => {
				await json(await call(`/manage/requests/${vow.id}/notify`, 'POST', {}));
				await db
					.update(integration)
					.set({ notifyOnDone: false })
					.where(eq(integration.id, connection!.id));
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
				assert.ok((await deliveries()).some((d) => d.status === 'canceled'));
				await db
					.update(integration)
					.set({ notifyOnDone: true })
					.where(eq(integration.id, connection!.id));
				await json(await call(`/manage/requests/${vow.id}/notify`, 'POST', {}));
				await json(
					await call(`/manage/requests/${vow.id}/status`, 'PATCH', {
						status: 'todo',
					})
				);
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
			}
		);
		await t.test(
			'interrupted sending jobs become uncertain without reposting',
			async () => {
				await db
					.update(notificationDelivery)
					.set({ status: 'sending', lockedAt: new Date(Date.now() - 600000) })
					.where(
						and(
							eq(notificationDelivery.requestId, vow.id),
							eq(notificationDelivery.status, 'canceled')
						)
					);
				await deliverNotifications(db, sender);
				assert.equal(sent, 1);
				const stale = await db
					.select()
					.from(notificationDelivery)
					.where(
						and(
							eq(notificationDelivery.requestId, vow.id),
							eq(notificationDelivery.status, 'sending')
						)
					);
				assert.equal(stale.length, 0);
			}
		);
		await t.test(
			'singular table names are used for all product data',
			async () => {
				const result = await db.execute(
					sql`select tablename from pg_tables where schemaname = 'public'`
				);
				const names = result.rows.map((r) => r.tablename);
				for (const name of [
					'Organization',
					'Customer',
					'Request',
					'CustomerAccess',
					'CustomerShareLink',
					'RequestEvent',
					'Integration',
					'RequestSlackThread',
					'NotificationDelivery',
				])
					assert.ok(names.includes(name));
				assert.ok(!names.includes('workspaces'));
				assert.ok(!names.includes('greetings'));
			}
		);
	}
);
after(async () => {
	if (process.env.TEST_DATABASE_URL) {
		const db = getDb();
		for (const clerkId of [admin.organizationId!, other.organizationId!])
			await db
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, clerkId));
		await closeDb();
	}
});
