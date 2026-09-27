import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createHttpApp } from '../src/http.js';
import {
	parseLinearLink,
	linearStatus,
	validLinearSignature,
} from '../src/linear.js';
import { processLinearWebhooks } from '../src/services/linear-sync.js';
import { deliverNotifications } from '../src/worker.js';
import { encrypt } from '../src/slack.js';
import {
	closeDb,
	eq,
	getDb,
	integration,
	linearWebhook,
	organization,
	requestEvent,
	request,
	requestLinearIssue,
} from '@repo/db';
import type { Identity } from '../src/context.js';

test('Linear links and workflow statuses are validated', () => {
	assert.deepEqual(
		parseLinearLink('https://linear.app/tembo/issue/ENG-123/title?x=1'),
		{ workspace: 'tembo', identifier: 'ENG-123' }
	);
	for (const url of [
		'https://linear.app.evil.test/tembo/issue/ENG-1',
		'http://linear.app/tembo/issue/ENG-1',
		'https://me@linear.app/tembo/issue/ENG-1',
		'https://linear.app:9000/tembo/issue/ENG-1',
		'https://localhost/private',
		'https://linear.app/tembo/project/abc',
	])
		assert.throws(() => parseLinearLink(url));
	for (const [type, name, status] of [
		['backlog', 'Backlog', 'todo'],
		['triage', 'Triage', 'todo'],
		['unstarted', 'Ready', 'todo'],
		['started', 'Building', 'in_progress'],
		['started', 'In Review', 'in_review'],
		['started', 'Review', 'in_review'],
		['completed', 'Shipped', 'done'],
		['canceled', 'Duplicate', 'canceled'],
	])
		assert.equal(linearStatus({ type: type!, name: name! }), status);
	assert.throws(() => linearStatus({ type: 'unknown', name: 'Done' }));
	const raw = Buffer.from('{"hello":true}');
	const signature = createHmac('sha256', 'test-secret')
		.update(raw)
		.digest('hex');
	assert.equal(validLinearSignature(raw, signature, 'test-secret'), true);
	assert.equal(
		validLinearSignature(Buffer.from('{}'), signature, 'test-secret'),
		false
	);
	for (const invalid of [undefined, 'a', 'z'.repeat(64)])
		assert.equal(validLinearSignature(raw, invalid, 'test-secret'), false);
});

test(
	'Linear integration: signed webhooks, tenant boundaries, audit privacy and Slack lifecycle',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString(
			'base64'
		);
		process.env.APP_URL = 'http://localhost';
		const db = getDb();
		const app = createApp();
		const http = createHttpApp({
			authenticateSession: async () => {
				throw new Error('Webhook must not use Clerk session authentication');
			},
		});
		const key = randomUUID();
		const admin: Identity = {
			userId: `admin-${key}`,
			organizationId: `org-${key}`,
			role: 'org:admin',
			verifiedEmails: [],
		};
		const outsider = { ...admin, organizationId: `other-${key}` };
		const viewer: Identity = {
			userId: `viewer-${key}`,
			organizationId: null,
			role: null,
			verifiedEmails: ['person@tembo.io'],
		};
		const apiKey = 'linear-test-api-key';
		const secret = 'linear-test-webhook-signing-secret';
		let issue = {
			id: randomUUID(),
			identifier: 'ENG-123',
			url: 'https://linear.app/tembo/issue/ENG-123/private-title',
			updatedAt: '2026-01-01T00:00:00.000Z',
			state: { name: 'Building', type: 'started' },
		};
		let externalOrg = { id: `linear-${key}`, name: 'Tembo', urlKey: 'tembo' };
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			assert.equal(input, 'https://api.linear.app/graphql');
			assert.equal(
				(init!.headers as Record<string, string>).Authorization,
				apiKey
			);
			const body = JSON.parse(init!.body as string);
			if (body.variables?.id) assert.equal(body.variables.id, 'ENG-123');
			return Response.json({ data: { organization: externalOrg, issue } });
		};
		async function call(
			path: string,
			method = 'GET',
			body?: unknown,
			identity = admin
		) {
			return app.fetch(
				new Request(`http://localhost/api${path}`, {
					method,
					headers: {
						Origin: 'http://localhost',
						'Content-Type': 'application/json',
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
				{
					identity,
					members: async () => [
						{ id: admin.userId, name: 'Admin', email: 'admin@test.io' },
					],
				}
			);
		}
		async function json(res: Response, status = 200) {
			const data = await res.json();
			assert.equal(res.status, status, JSON.stringify(data));
			return data;
		}
		try {
			const customer = await json(
				await call('/manage/customers', 'POST', { name: 'Tembo' }),
				201
			);
			const otherCustomer = await json(
				await call('/manage/customers', 'POST', { name: 'Other' }),
				201
			);
			const row = await json(
				await call(`/manage/customers/${customer.id}/requests`, 'POST', {
					title: 'Public title',
					internalNotes: 'PRIVATE NOTES',
				}),
				201
			);
			const otherRow = await json(
				await call(`/manage/customers/${otherCustomer.id}/requests`, 'POST', {
					title: 'Other request',
				}),
				201
			);
			assert.equal(
				(
					await call(`/manage/requests/${row.id}/linear`, 'POST', {
						url: issue.url,
					})
				).status,
				400
			);
			assert.equal(
				(
					await call(
						'/manage/integrations/linear',
						'POST',
						{ apiKey },
						{ ...admin, role: 'org:member' }
					)
				).status,
				403
			);
			await json(await call('/manage/integrations/linear', 'POST', { apiKey }));
			const createdWithLinear = await json(
				await call(`/manage/customers/${customer.id}/requests`, 'POST', {
					title: 'Linked during creation',
					linearUrl: issue.url,
				}),
				201
			);
			assert.equal(createdWithLinear.status, 'in_progress');
			const createdDetail = await json(
				await call(`/manage/requests/${createdWithLinear.id}`)
			);
			assert.equal(createdDetail.linear.identifier, 'ENG-123');
			const creationEvents = await db
				.select()
				.from(requestEvent)
				.where(eq(requestEvent.requestId, createdWithLinear.id));
			assert.ok(creationEvents.some((event) => event.kind === 'created'));
			assert.ok(creationEvents.some((event) => event.kind === 'linear_linked'));
			await db.delete(request).where(eq(request.id, createdWithLinear.id));
			for (const url of [
				'https://example.com/invalid',
				'https://linear.app/other/issue/ENG-123/title',
			]) {
				const failed = await call(
					`/manage/customers/${customer.id}/requests`,
					'POST',
					{
						title: 'Invalid link must not create a request',
						linearUrl: url,
					}
				);
				assert.equal(failed.status, 400);
				const partial = await db
					.select()
					.from(request)
					.where(eq(request.title, 'Invalid link must not create a request'));
				assert.equal(partial.length, 0);
			}
			let settings = await json(await call('/manage/integrations'));
			assert.equal(settings.linear.webhookConfigured, false);
			assert.ok(!JSON.stringify(settings).includes(apiKey));
			const [connection] = await db
				.select()
				.from(integration)
				.where(eq(integration.id, settings.linear.id));
			assert.ok(!connection!.encryptedCredentials!.includes(apiKey));
			await json(
				await call('/manage/integrations/linear', 'PATCH', {
					webhookSecret: secret,
				})
			);
			settings = await json(await call('/manage/integrations'));
			assert.equal(settings.linear.webhookConfigured, true);
			assert.ok(!JSON.stringify(settings).includes(secret));
			assert.equal(
				(
					await call(
						`/manage/requests/${row.id}/linear`,
						'POST',
						{ url: issue.url },
						outsider
					)
				).status,
				404
			);
			assert.equal(
				(
					await call(`/manage/requests/${row.id}/linear`, 'POST', {
						url: issue.url.replace('/tembo/', '/evil/'),
					})
				).status,
				400
			);
			await json(
				await call(`/manage/requests/${row.id}/linear`, 'POST', {
					url: issue.url,
				})
			);
			let detail = await json(await call(`/manage/requests/${row.id}`));
			assert.equal(detail.status, 'in_progress');
			assert.equal(detail.linear.identifier, 'ENG-123');
			assert.ok(
				detail.events.some(
					(e: { kind: string; source: string }) =>
						e.kind === 'status_changed' && e.source === 'linear'
				)
			);
			const count = detail.events.length;
			await json(
				await call(`/manage/requests/${row.id}/linear`, 'POST', {
					url: issue.url,
				})
			);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).events.length,
				count
			);
			const [slack] = await db
				.insert(integration)
				.values({
					organizationId: row.organizationId,
					provider: 'slack',
					externalAccountId: `slack-${key}`,
					externalAccountName: 'Slack',
					encryptedCredentials: encrypt('slack-test'),
					notifyOnDone: true,
				})
				.returning();
			assert.ok(slack);
			await json(
				await call(`/manage/requests/${row.id}`, 'PUT', {
					...detail,
					title: 'Updated public title',
					description: 'Public description',
					internalNotes: 'NEW PRIVATE NOTES',
					completionNote: 'Ready!',
					assigneeId: admin.userId,
					slackUrl: 'https://tembo.slack.com/archives/C123/p1726854333000001',
				})
			);
			async function webhook(
				overrides: Record<string, unknown> = {},
				signatureOverride?: string
			) {
				const payload = {
					organizationId: externalOrg.id,
					webhookTimestamp: Date.now(),
					type: 'Issue',
					action: 'update',
					createdAt: issue.updatedAt,
					data: issue,
					...overrides,
				};
				const raw = JSON.stringify(payload);
				const signature =
					signatureOverride ??
					createHmac('sha256', secret).update(raw).digest('hex');
				return http.fetch(
					new Request(settings.linear.webhookUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Linear-Signature': signature,
						},
						body: raw,
					})
				);
			}
			assert.equal((await webhook({}, '0'.repeat(64))).status, 401);
			assert.equal(
				(await webhook({ organizationId: 'different-linear-workspace' }))
					.status,
				401
			);
			assert.equal(
				(await webhook({ webhookTimestamp: Date.now() - 120000 })).status,
				401
			);
			assert.equal((await webhook({ data: { id: issue.id } })).status, 400);
			issue = {
				...issue,
				updatedAt: '2026-01-02T00:00:00.000Z',
				state: { name: 'In review', type: 'started' },
			};
			const stableTimestamp = Date.now();
			await json(await webhook({ webhookTimestamp: stableTimestamp }));
			await json(await webhook({ webhookTimestamp: stableTimestamp }));
			assert.equal(
				(
					await db
						.select()
						.from(linearWebhook)
						.where(eq(linearWebhook.integrationId, connection!.id))
				).length,
				1
			);
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'in_review'
			);
			issue = {
				...issue,
				updatedAt: '2026-01-03T00:00:00.000Z',
				state: { name: 'Done', type: 'completed' },
			};
			await json(await webhook());
			await processLinearWebhooks(db);
			detail = await json(await call(`/manage/requests/${row.id}`));
			assert.equal(detail.status, 'done');
			assert.ok(detail.completedAt);
			assert.equal(detail.deliveries.length, 1);
			assert.equal(detail.deliveries[0].status, 'pending');
			await json(
				await webhook({
					data: {
						...issue,
						updatedAt: '2026-01-02T12:00:00.000Z',
						state: { name: 'Building', type: 'started' },
					},
				})
			);
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'done'
			);
			// A replay with a different transmission timestamp still has no duplicate effects.
			await json(await webhook());
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).deliveries
					.length,
				1
			);
			await deliverNotifications(db, async <T>() => ({ ts: '123.456' }) as T);
			const share = await json(
				await call(`/manage/customers/${customer.id}/sharing`, 'POST', {})
			);
			await json(
				await call(`/manage/customers/${customer.id}/access`, 'POST', {
					kind: 'domain',
					email: '@tembo.io',
				})
			);
			const portal = share.path.replace('/share/', '/portal/');
			const history = await json(
				await call(
					`${portal}/requests/${row.id}/events`,
					'GET',
					undefined,
					viewer
				)
			);
			assert.ok(
				history.events.some(
					(e: { kind: string }) => e.kind === 'notification_sent'
				)
			);
			assert.ok(
				history.events.some((e: { kind: string }) => e.kind === 'title_changed')
			);
			assert.ok(
				history.events.some((e: { kind: string }) => e.kind === 'linear_linked')
			);
			assert.ok(!JSON.stringify(history).includes('PRIVATE'));
			assert.ok(!JSON.stringify(history).includes('private-title'));
			assert.ok(!JSON.stringify(history).includes('actorId'));
			assert.ok(!JSON.stringify(history).includes('internalNotes'));
			assert.equal(
				(
					await call(
						`${portal}/requests/${otherRow.id}/events`,
						'GET',
						undefined,
						viewer
					)
				).status,
				404
			);
			assert.equal(
				(
					await call(
						`/manage/requests/${row.id}/events`,
						'GET',
						undefined,
						outsider
					)
				).status,
				404
			);
			assert.equal(
				(
					await call(`${portal}/requests/${row.id}/events`, 'GET', undefined, {
						...viewer,
						verifiedEmails: [],
					})
				).status,
				403
			);
			const staff = await json(await call(`/manage/requests/${row.id}/events`));
			assert.ok(JSON.stringify(staff).includes('NEW PRIVATE NOTES'));
			// Cursor pagination retains events written at the same microsecond.
			await db.insert(requestEvent).values(
				Array.from({ length: 65 }, () => ({
					requestId: row.id,
					actorId: 'team',
					kind: 'description_changed',
					toStatus: 'done' as const,
				}))
			);
			const page1 = await json(
				await call(
					`${portal}/requests/${row.id}/events`,
					'GET',
					undefined,
					viewer
				)
			);
			const page2 = await json(
				await call(
					`${portal}/requests/${row.id}/events?cursor=${page1.nextCursor}`,
					'GET',
					undefined,
					viewer
				)
			);
			assert.equal(page1.events.length, 50);
			assert.ok(page2.events.length >= 15);
			assert.equal(
				new Set(
					[...page1.events, ...page2.events].map((e: { id: string }) => e.id)
				).size,
				page1.events.length + page2.events.length
			);
			await json(
				await call(`/manage/requests/${row.id}/status`, 'PATCH', {
					status: 'todo',
				})
			);
			// Updating the issue title without changing its state preserves a manual Vows status.
			issue = { ...issue, updatedAt: '2026-01-04T00:00:00.000Z' };
			await json(await webhook());
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'todo'
			);
			issue = {
				...issue,
				updatedAt: '2026-01-05T00:00:00.000Z',
				state: { name: 'Building', type: 'started' },
			};
			await json(await webhook());
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'in_progress'
			);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).completedAt,
				null
			);
			await json(await call(`/manage/requests/${row.id}/linear`, 'DELETE', {}));
			issue = {
				...issue,
				updatedAt: '2026-01-06T00:00:00.000Z',
				state: { name: 'Done', type: 'completed' },
			};
			await json(await webhook());
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'in_progress'
			);
			await json(
				await call(`/manage/requests/${row.id}/linear`, 'POST', {
					url: issue.url,
				})
			);
			issue = {
				...issue,
				updatedAt: '2026-01-07T00:00:00.000Z',
				state: { name: 'Canceled', type: 'canceled' },
			};
			await json(await webhook());
			await json(await call('/manage/integrations/linear', 'DELETE', {}));
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'done'
			);
			assert.equal((await webhook()).status, 401);
			const [disconnected] = await db
				.select()
				.from(integration)
				.where(eq(integration.id, connection!.id));
			assert.equal(disconnected!.encryptedCredentials, null);
			// Reconnecting to another workspace removes links to the previous one.
			externalOrg = { ...externalOrg, id: `new-${key}` };
			await json(await call('/manage/integrations/linear', 'POST', { apiKey }));
			assert.equal(
				(
					await db
						.select()
						.from(requestLinearIssue)
						.where(eq(requestLinearIssue.requestId, row.id))
				).length,
				0
			);
			assert.equal(
				(await json(await call('/manage/integrations'))).linear
					.webhookConfigured,
				false
			);

			await json(
				await call('/manage/integrations/linear', 'PATCH', {
					webhookSecret: secret,
				})
			);
			await json(
				await call(`/manage/requests/${row.id}/linear`, 'POST', {
					url: issue.url,
				})
			);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'canceled'
			);
			await json(
				await webhook({
					action: 'remove',
					createdAt: '2026-01-08T00:00:00.000Z',
				})
			);
			await processLinearWebhooks(db);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).linear,
				null
			);
			assert.equal(
				(await json(await call(`/manage/requests/${row.id}`))).status,
				'canceled'
			);
		} finally {
			globalThis.fetch = originalFetch;
			await db
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, admin.organizationId!));
			await db
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, outsider.organizationId!));
			await closeDb();
		}
	}
);
