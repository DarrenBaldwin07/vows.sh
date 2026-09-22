import test from 'node:test';
import {
	Client,
	StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createAgentMcpHandler } from '../src/mcp.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import {
	authenticateAgentKey,
	hashAgentKey,
	newAgentKey,
	type AgentPrincipal,
} from '../src/agent-keys.js';
import {
	authorizeAgentCall,
	executeAgentCall,
	compact,
} from '../src/agent-service.js';
import { requestPatchInput } from '../src/validation.js';
import {
	getDb,
	closeDb,
	organization,
	agentKey,
	agentOperation,
	customer,
	request,
	eq,
} from '@repo/db';

const identity = {
	userId: 'agent-test-user',
	organizationId: 'org-agent-test',
	role: 'org:member',
	verifiedEmails: [],
};
const principal: AgentPrincipal = {
	id: 'test-key',
	organizationId: 'test-org',
	permission: 'read',
	identity,
};
test('agent keys have high entropy and only digests are persisted', () => {
	const a = newAgentKey(),
		b = newAgentKey();
	assert.match(a, /^vows_[A-Za-z0-9_-]{43}$/);
	assert.notEqual(a, b);
	assert.match(hashAgentKey(a), /^[0-9a-f]{64}$/);
	assert.notEqual(hashAgentKey(a), a);
});
test('agent allowlist and write scopes cannot be bypassed', () => {
	authorizeAgentCall(principal, { path: '/manage/customers' });
	for (const call of [
		{ path: '/manage/agent-keys' },
		{ path: '/manage/customers/id/access' },
		{ path: '/portal/token' },
		{ path: '/manage/customers', method: 'POST', body: {} },
		{ path: '/manage/../manage/agent-keys' },
		{ path: '/manage/customers/%2e%2e' },
	]) {
		assert.throws(() => authorizeAgentCall(principal, call));
	}
	const write = { ...principal, permission: 'write' as const };
	assert.throws(() =>
		authorizeAgentCall(write, { path: '/manage/customers', method: 'POST' })
	);
	assert.throws(() =>
		authorizeAgentCall(write, {
			path: '/manage/requests/id',
			method: 'PATCH',
			idempotencyKey: 'x',
		})
	);
	assert.throws(() =>
		authorizeAgentCall(write, {
			path: '/manage/integrations/slack',
			method: 'DELETE',
			idempotencyKey: 'x',
		})
	);
});
test('partial request updates do not inject defaults or erase omitted fields', () => {
	assert.deepEqual(requestPatchInput.parse({ assigneeId: 'user_123' }), {
		assigneeId: 'user_123',
	});
	assert.deepEqual(requestPatchInput.parse({ status: 'done' }), {
		status: 'done',
	});
	assert.throws(() => requestPatchInput.parse({ organizationId: 'other' }));
});
test('compact results omit image data without corrupting dates', () => {
	assert.deepEqual(
		compact({
			imageData: 'large',
			organizationId: 'private',
			updatedAt: new Date('2026-01-01'),
			nested: { imageData: 'large', name: 'Acme' },
		}),
		{ updatedAt: '2026-01-01T00:00:00.000Z', nested: { name: 'Acme' } }
	);
});

test(
	'agents: database isolation, revocation, idempotency and safe edits',
	{ skip: !process.env.TEST_DATABASE_URL },
	async () => {
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const db = getDb();
		const suffix = randomUUID();
		const [org] = await db
			.insert(organization)
			.values({ clerkOrganizationId: `org-${suffix}` })
			.returning();
		const [other] = await db
			.insert(organization)
			.values({ clerkOrganizationId: `other-${suffix}` })
			.returning();
		const user = {
			...identity,
			organizationId: org!.clerkOrganizationId,
			userId: suffix,
		};
		const bindings = {
			identity: user,
			members: async () => [
				{ id: suffix, name: 'Member', email: 'member@example.test' },
			],
		};
		const app = createApp();
		const manage = (path: string, method = 'GET', body?: unknown, as = user) =>
			app.fetch(
				new Request(`http://test/api/manage${path}`, {
					method,
					headers: {
						Origin: 'http://test',
						'Content-Type': 'application/json',
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
				{ ...bindings, identity: as }
			);
		try {
			const response = await manage('/agent-keys', 'POST', {
				name: 'test',
				permission: 'write',
			});
			assert.equal(response.status, 201, await response.clone().text());
			const issued = (await response.json()) as { id: string; token: string };
			const stored = (
				await db.select().from(agentKey).where(eq(agentKey.id, issued.id))
			)[0]!;
			assert.equal(stored.tokenHash, hashAgentKey(issued.token));
			assert.ok(
				!JSON.stringify(await (await manage('/agent-keys')).json()).includes(
					issued.token
				)
			);
			const actor = await authenticateAgentKey(
				db,
				`Bearer ${issued.token}`,
				async (orgId, userId) =>
					orgId === org!.clerkOrganizationId && userId === suffix
						? 'org:member'
						: null
			);
			await assert.rejects(
				authenticateAgentKey(db, `Bearer ${issued.token}`, async () => null)
			);
			for (const mode of ['legacy', 'auto'] as const) {
				const mcp = createAgentMcpHandler(actor, bindings, db);
				const client = new Client(
					{ name: 'vows-test', version: '1.0.0' },
					{ versionNegotiation: { mode } }
				);
				const transport = new StreamableHTTPClientTransport(
					new URL('http://localhost/mcp'),
					{
						requestInit: {
							headers: { Authorization: `Bearer ${issued.token}` },
						},
						fetch: async (input, init) => {
							const req = new Request(input, init);
							await authenticateAgentKey(
								db,
								req.headers.get('Authorization'),
								async () => 'org:member'
							);
							return mcp.fetch(req);
						},
					}
				);
				try {
					await client.connect(transport);
					const tools = await client.listTools();
					assert.equal(tools.tools.length, 13);
					assert.ok(tools.tools.some((tool) => tool.name === 'assign_request'));
					const result = await client.callTool({
						name: 'list_customers',
						arguments: { limit: 1 },
					});
					assert.ok(!result.isError, JSON.stringify(result));
					const made = await client.callTool({
						name: 'create_customer',
						arguments: {
							name: `MCP ${mode}`,
							idempotencyKey: `mcp-customer-${mode}`,
						},
					});
					assert.ok(!made.isError, JSON.stringify(made));
					const madeData = made.structuredContent as {
						result: { data: { id: string; updatedAt: string } };
					};
					assert.ok(madeData.result.data.id);
					const imageData =
						'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
					const imageArgs = {
						customerId: madeData.result.data.id,
						imageData,
						expectedUpdatedAt: madeData.result.data.updatedAt,
						idempotencyKey: `mcp-image-${mode}`,
					};
					const upload = await client.callTool({
						name: 'set_customer_image',
						arguments: imageArgs,
					});
					assert.ok(!upload.isError, JSON.stringify(upload));
					assert.ok(!JSON.stringify(upload).includes(imageData));
					const imageRow = (
						await db
							.select()
							.from(customer)
							.where(eq(customer.id, imageArgs.customerId))
					)[0]!;
					assert.equal(imageRow.imageData, imageData);
					assert.equal(imageRow.name, `MCP ${mode}`);
					const replay = await client.callTool({
						name: 'set_customer_image',
						arguments: imageArgs,
					});
					assert.deepEqual(replay.structuredContent, upload.structuredContent);
					const stale = await client.callTool({
						name: 'set_customer_image',
						arguments: {
							...imageArgs,
							imageData: null,
							idempotencyKey: `mcp-image-stale-${mode}`,
						},
					});
					assert.equal(stale.isError, true);
					const invalid = await client.callTool({
						name: 'set_customer_image',
						arguments: {
							...imageArgs,
							imageData: 'data:image/png;base64,aGVsbG8=',
							expectedUpdatedAt: imageRow.updatedAt.toISOString(),
							idempotencyKey: `mcp-image-invalid-${mode}`,
						},
					});
					assert.equal(invalid.isError, true);
					const removed = await client.callTool({
						name: 'set_customer_image',
						arguments: {
							...imageArgs,
							imageData: null,
							expectedUpdatedAt: imageRow.updatedAt.toISOString(),
							idempotencyKey: `mcp-image-remove-${mode}`,
						},
					});
					assert.ok(!removed.isError, JSON.stringify(removed));
					assert.equal(
						(
							await db
								.select()
								.from(customer)
								.where(eq(customer.id, imageArgs.customerId))
						)[0]!.imageData,
						null
					);

					const madeRequest = await client.callTool({
						name: 'create_request',
						arguments: {
							customerId: madeData.result.data.id,
							title: 'MCP request',
							description: 'Preserve via MCP',
							idempotencyKey: `mcp-request-${mode}`,
						},
					});
					assert.ok(!madeRequest.isError, JSON.stringify(madeRequest));
					const requestData = madeRequest.structuredContent as {
						result: { data: { id: string; updatedAt: string } };
					};
					const assigned = await client.callTool({
						name: 'assign_request',
						arguments: {
							requestId: requestData.result.data.id,
							assigneeId: suffix,
							expectedUpdatedAt: requestData.result.data.updatedAt,
							idempotencyKey: `mcp-assign-${mode}`,
						},
					});
					assert.ok(!assigned.isError, JSON.stringify(assigned));
					const assignedData = assigned.structuredContent as {
						result: { data: { description: string } };
					};
					assert.equal(
						assignedData.result.data.description,
						'Preserve via MCP'
					);

					const bad = await client.callTool({
						name: 'create_customer',
						arguments: { name: 'No retry key' },
					});
					assert.equal(bad.isError, true);
				} finally {
					await client.close();
					await mcp.close();
				}
			}

			await assert.rejects(
				authenticateAgentKey(
					db,
					`Bearer ${newAgentKey()}`,
					async () => 'org:member'
				)
			);
			await db
				.update(agentKey)
				.set({ expiresAt: new Date('2020-01-01') })
				.where(eq(agentKey.id, issued.id));
			await assert.rejects(
				authenticateAgentKey(
					db,
					`Bearer ${issued.token}`,
					async () => 'org:member'
				)
			);
			await db
				.update(agentKey)
				.set({ expiresAt: new Date(Date.now() + 86400000) })
				.where(eq(agentKey.id, issued.id));

			const create = {
				path: '/manage/customers',
				method: 'POST',
				body: { name: 'Agent customer' },
				idempotencyKey: 'create-customer',
			};
			const [first, retry] = (await Promise.all([
				executeAgentCall(actor, create, bindings, db),
				executeAgentCall(actor, create, bindings, db),
			])) as [{ data: { id: string } }, { data: { id: string } }];
			assert.equal(first.data.id, retry.data.id);
			await assert.rejects(
				executeAgentCall(
					actor,
					{ ...create, body: { name: 'Changed' } },
					bindings,
					db
				)
			);
			const foreign = (
				await db
					.insert(customer)
					.values({ organizationId: other!.id, name: 'Other customer' })
					.returning()
			)[0]!;
			await assert.rejects(
				executeAgentCall(
					actor,
					{ path: `/manage/customers/${foreign.id}` },
					bindings,
					db
				)
			);
			await assert.rejects(
				executeAgentCall({ ...actor, permission: 'read' }, create, bindings, db)
			);
			const created = (await executeAgentCall(
				actor,
				{
					path: `/manage/customers/${first.data.id}/requests`,
					method: 'POST',
					body: {
						title: 'Keep these details',
						description: 'Description stays',
						internalNotes: 'Notes stay',
						completionNote: 'Completion stays',
						status: 'in_review',
					},
					idempotencyKey: 'create-request',
				},
				bindings,
				db
			)) as { data: { id: string; updatedAt: string } };
			const patch = {
				path: `/manage/requests/${created.data.id}`,
				method: 'PATCH',
				body: { assigneeId: suffix },
				expectedUpdatedAt: created.data.updatedAt,
				idempotencyKey: 'assign',
			};
			const updated = (await executeAgentCall(actor, patch, bindings, db)) as {
				data: { updatedAt: string };
			};
			const saved = (
				await db.select().from(request).where(eq(request.id, created.data.id))
			)[0]!;
			assert.equal(saved.description, 'Description stays');
			assert.equal(saved.internalNotes, 'Notes stay');
			assert.equal(saved.completionNote, 'Completion stays');
			assert.equal(saved.status, 'in_review');
			assert.equal(saved.assigneeId, suffix);
			assert.deepEqual(
				await executeAgentCall(actor, patch, bindings, db),
				updated
			);
			await assert.rejects(
				executeAgentCall(
					actor,
					{
						...patch,
						idempotencyKey: 'stale',
						expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
					},
					bindings,
					db
				)
			);
			const races = await Promise.allSettled([
				executeAgentCall(
					actor,
					{
						...patch,
						body: { title: 'First edit' },
						expectedUpdatedAt: updated.data.updatedAt,
						idempotencyKey: 'race-a',
					},
					bindings,
					db
				),
				executeAgentCall(
					actor,
					{
						...patch,
						body: { title: 'Second edit' },
						expectedUpdatedAt: updated.data.updatedAt,
						idempotencyKey: 'race-b',
					},
					bindings,
					db
				),
			]);
			assert.equal(
				races.filter((result) => result.status === 'fulfilled').length,
				1
			);
			assert.equal(
				races.filter((result) => result.status === 'rejected').length,
				1
			);

			const ops = await db
				.select()
				.from(agentOperation)
				.where(eq(agentOperation.principalId, actor.id));
			assert.equal(ops.length, 14);
			assert.equal(
				(
					await manage(
						`/agent-keys/${issued.id}`,
						'DELETE',
						{},
						{ ...user, userId: 'different' }
					)
				).status,
				404
			);
			assert.equal(
				(await manage(`/agent-keys/${issued.id}`, 'DELETE', {})).status,
				200
			);
			await assert.rejects(
				authenticateAgentKey(
					db,
					`Bearer ${issued.token}`,
					async () => 'org:member'
				)
			);
			await assert.rejects(
				executeAgentCall(
					actor,
					{ ...create, idempotencyKey: 'after-revoke' },
					bindings,
					db
				)
			);
		} finally {
			await db.delete(organization).where(eq(organization.id, org!.id));
			await db.delete(organization).where(eq(organization.id, other!.id));
			await closeDb();
		}
	}
);
