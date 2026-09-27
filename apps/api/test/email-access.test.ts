import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accessInput } from '../src/validation.js';
import { matchesEmailAccess } from '../src/services/email-access.js';
import { createApp } from '../src/app.js';
import { closeDb, eq, getDb, organization } from '@repo/db';
import type { Identity } from '../src/context.js';

test('email access inputs preserve existing invites and normalize domains', () => {
	assert.deepEqual(accessInput.parse({ email: ' Person@Tembo.io ' }), {
		kind: 'email',
		email: 'person@tembo.io',
	});
	for (const email of ['tembo.io', '@TEMBO.IO', '*@tembo.io'])
		assert.equal(
			accessInput.parse({ kind: 'domain', email }).email,
			'tembo.io'
		);
	for (const email of [
		'https://tembo.io',
		'person@tembo.io',
		'@',
		'tembo..io',
		'-tembo.io',
	])
		assert.equal(
			accessInput.safeParse({ kind: 'domain', email }).success,
			false
		);
	for (const email of ['[', '(a)\\1', 'a'.repeat(501)])
		assert.equal(
			accessInput.safeParse({ kind: 'regex', email }).success,
			false
		);
	assert.equal(
		accessInput.safeParse({ kind: 'unknown', email: 'person@tembo.io' })
			.success,
		false
	);
});

test('domain and regex rules match whole verified emails and allow multiple users', () => {
	for (const input of [
		{ kind: 'domain', email: '@tembo.io' },
		{ kind: 'regex', email: '.*@tembo\\.io' },
	]) {
		const rule = { ...accessInput.parse(input), clerkUserId: null };
		for (const userId of ['first', 'second']) {
			assert.equal(
				matchesEmailAccess(rule, {
					userId,
					verifiedEmails: ['outside@example.com', `${userId}@TEMBO.IO`],
				}),
				true
			);
			for (const email of [
				'person@tembo.io.evil.com',
				'person@eviltembo.io',
				'person@sub.tembo.io',
				'person@temboXio',
			])
				assert.equal(
					matchesEmailAccess(rule, { userId, verifiedEmails: [email] }),
					false
				);
			assert.equal(
				matchesEmailAccess(rule, { userId, verifiedEmails: [] }),
				false
			);
		}
	}
	assert.equal(
		matchesEmailAccess(
			{ kind: 'regex', email: '(a+)+@tembo\\.io', clerkUserId: null },
			{ userId: 'a', verifiedEmails: [`${'a'.repeat(300)}!@tembo.io`] }
		),
		false
	);
	assert.equal(
		matchesEmailAccess(
			{ kind: 'regex', email: '[', clerkUserId: null },
			{ userId: 'a', verifiedEmails: ['a@tembo.io'] }
		),
		false
	);
	assert.equal(
		matchesEmailAccess(
			{ kind: 'email', email: 'a@tembo.io', clerkUserId: 'first' },
			{ userId: 'second', verifiedEmails: ['a@tembo.io'] }
		),
		false
	);
});

test(
	'portal rules authorize reads and submissions, stay shared, and revoke immediately',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const app = createApp();
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
			verifiedEmails: ['person@tembo.io'],
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
				{ identity }
			);
		}
		async function json(response: Response, expected = 200) {
			const body = await response.json();
			assert.equal(response.status, expected, JSON.stringify(body));
			return body;
		}
		try {
			const customer = await json(
				await call('/manage/customers', 'POST', { name: 'Tembo' }),
				201
			);
			const other = await json(
				await call('/manage/customers', 'POST', { name: 'Other' }),
				201
			);
			const base = `/manage/customers/${customer.id}`;
			const link = await json(await call(`${base}/sharing`, 'POST', {}));
			const otherLink = await json(
				await call(`/manage/customers/${other.id}/sharing`, 'POST', {})
			);
			const paths = [link.path, link.legacyPath].map((p: string) =>
				p.replace('/share/', '/portal/')
			);
			for (const kind of ['domain', 'regex']) {
				const rule = {
					kind,
					email: kind === 'domain' ? '@tembo.io' : '.*@tembo\\.io',
				};
				assert.equal(
					(
						await call(`${base}/access`, 'POST', rule, {
							...admin,
							role: 'org:member',
						})
					).status,
					403
				);
				assert.equal(
					(
						await call(`${base}/access`, 'POST', rule, {
							...admin,
							organizationId: `other-${key}`,
						})
					).status,
					404
				);
				await json(await call(`${base}/access`, 'POST', rule));
				await json(await call(`${base}/access`, 'POST', rule));
				let sharing = await json(await call(`${base}/sharing`));
				assert.equal(sharing.access.length, 1);
				const access = sharing.access[0];
				assert.equal(access.kind, kind);
				for (const path of paths) {
					for (const who of [
						viewer,
						{
							...viewer,
							userId: `second-${key}`,
							verifiedEmails: ['SECOND@TEMBO.IO'],
						},
					]) {
						await json(await call(path, 'GET', undefined, who));
						await json(
							await call(
								`${path}/requests`,
								'POST',
								{ title: 'A request' },
								who
							),
							201
						);
					}
					for (const emails of [
						[],
						['a@tembo.io.evil.com'],
						['a@sub.tembo.io'],
					]) {
						const who = { ...viewer, verifiedEmails: emails };
						assert.equal((await call(path, 'GET', undefined, who)).status, 403);
						assert.equal(
							(await call(`${path}/requests`, 'POST', { title: 'Denied' }, who))
								.status,
							403
						);
					}
				}
				sharing = await json(await call(`${base}/sharing`));
				assert.equal(sharing.access[0].accepted, false);
				assert.equal(
					(
						await call(
							otherLink.path.replace('/share/', '/portal/'),
							'GET',
							undefined,
							viewer
						)
					).status,
					403
				);
				await json(await call(`${base}/access/${access.id}`, 'DELETE', {}));
				for (const path of paths) {
					assert.equal(
						(await call(path, 'GET', undefined, viewer)).status,
						403
					);
					assert.equal(
						(
							await call(
								`${path}/requests`,
								'POST',
								{ title: 'Denied' },
								viewer
							)
						).status,
						403
					);
				}
				await json(await call(`${base}/access`, 'POST', rule));
				await json(await call(paths[0]!, 'GET', undefined, viewer));
				await json(await call(`${base}/access/${access.id}`, 'DELETE', {}));
			}
			assert.equal(
				(await call(`${base}/access`, 'POST', { kind: 'regex', email: '[' }))
					.status,
				400
			);
		} finally {
			await getDb()
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, admin.organizationId!));
			await getDb()
				.delete(organization)
				.where(eq(organization.clerkOrganizationId, `other-${key}`));
			await closeDb();
		}
	}
);
