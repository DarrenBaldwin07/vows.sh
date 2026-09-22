import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
	agentOperation,
	customer,
	request,
	agentKey,
	and,
	eq,
	isNull,
	sql,
	desc,
	getDb,
	type Database,
} from '@repo/db';
import { createApp } from './app.js';
import type { AgentPrincipal } from './agent-keys.js';
import type { Env } from './context.js';
import { requestInput, requestPatchInput } from './validation.js';

export function compact(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(compact);
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([key]) => !['imageData', 'tokenHash', 'organizationId'].includes(key)
				)
				.map(([key, item]) => [key, compact(item)])
		);
	return value;
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(',')}}`;
	return JSON.stringify(value) ?? 'null';
}
const allowedRead =
	/^\/manage\/(customers(?:\/[^/]+)?|requests(?:\/[^/]+)?|members|search)$/;
const allowedWrite =
	/^(POST \/manage\/customers|PATCH \/manage\/customers\/[^/]+|POST \/manage\/customers\/[^/]+\/requests|PATCH \/manage\/requests\/[^/]+(?:\/status)?)$/;
export type AgentCall = {
	path: string;
	method?: string;
	body?: unknown;
	idempotencyKey?: string;
	expectedUpdatedAt?: string;
};
export function authorizeAgentCall(principal: AgentPrincipal, call: AgentCall) {
	const path = new URL(call.path, 'http://vows.internal').pathname;
	if (
		!call.path.startsWith('/manage/') ||
		call.path.includes('..') ||
		path.includes('%')
	)
		throw new HTTPException(403, { message: 'Unsupported agent operation.' });
	const method = call.method ?? 'GET';
	if (
		method === 'GET'
			? !allowedRead.test(path)
			: !allowedWrite.test(`${method} ${path}`)
	)
		throw new HTTPException(403, {
			message: 'This operation is not available to agents.',
		});
	if (method !== 'GET' && principal.permission !== 'write')
		throw new HTTPException(403, {
			message: 'This connection has read-only access.',
		});
	if (method !== 'GET') z.string().min(1).max(128).parse(call.idempotencyKey);
	if (method === 'PATCH')
		z.iso.datetime({ offset: true }).parse(call.expectedUpdatedAt);
}
async function executeAgentCallUnchecked(
	principal: AgentPrincipal,
	call: AgentCall,
	bindings: Env['Bindings'],
	database: Database = getDb()
) {
	authorizeAgentCall(principal, call);
	const method = call.method ?? 'GET';
	async function dispatch(
		db: Database,
		path: string,
		verb: string,
		body?: unknown
	) {
		const res = await createApp(() => db).fetch(
			new Request(`http://vows.internal/api${path}`, {
				method: verb,
				headers: {
					'Content-Type': 'application/json',
					Origin: 'http://vows.internal',
					'X-Organization-Id': principal.identity.organizationId!,
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
			{ ...bindings, identity: principal.identity }
		);
		const result = await res.json();
		if (!res.ok)
			throw new HTTPException(res.status as 400, {
				message: (result as { error?: string }).error ?? 'Operation failed.',
			});
		return result;
	}
	if (method === 'GET') {
		const url = new URL(call.path, 'http://vows.internal');
		if (
			url.pathname === '/manage/customers' ||
			url.pathname === '/manage/requests'
		) {
			const limit = z.coerce
				.number()
				.int()
				.min(1)
				.max(100)
				.parse(url.searchParams.get('limit') ?? 50);
			const offset = z.coerce
				.number()
				.int()
				.min(0)
				.max(100000)
				.parse(url.searchParams.get('offset') ?? 0);
			const rows =
				url.pathname === '/manage/customers'
					? await database
							.select({
								id: customer.id,
								name: customer.name,
								domain: customer.domain,
								archivedAt: customer.archivedAt,
								updatedAt: customer.updatedAt,
							})
							.from(customer)
							.where(
								and(
									eq(customer.organizationId, principal.organizationId),
									isNull(customer.archivedAt)
								)
							)
							.orderBy(desc(customer.updatedAt), customer.id)
							.limit(limit + 1)
							.offset(offset)
					: await database
							.select({
								id: request.id,
								customerId: request.customerId,
								title: request.title,
								status: request.status,
								assigneeId: request.assigneeId,
								updatedAt: request.updatedAt,
							})
							.from(request)
							.where(
								and(
									eq(request.organizationId, principal.organizationId),
									...(url.searchParams.has('customerId')
										? [
												eq(
													request.customerId,
													url.searchParams.get('customerId')!
												),
											]
										: []),
									...(url.searchParams.has('status')
										? [
												eq(
													request.status,
													z
														.enum([
															'todo',
															'in_progress',
															'in_review',
															'done',
															'canceled',
														])
														.parse(url.searchParams.get('status'))
												),
											]
										: []),
									...(url.searchParams.has('assigneeId')
										? [
												eq(
													request.assigneeId,
													url.searchParams.get('assigneeId')!
												),
											]
										: [])
								)
							)
							.orderBy(desc(request.updatedAt), request.id)
							.limit(limit + 1)
							.offset(offset);
			return {
				items: compact(rows.slice(0, limit)),
				nextOffset: rows.length > limit ? offset + limit : null,
			};
		}
		const result = await dispatch(database, call.path, 'GET');
		if (/^\/manage\/customers\/[^/?]+$/.test(call.path))
			return compact((result as { customer: unknown }).customer);
		return compact(result);
	}
	const inputHash = createHash('sha256').update(canonical(call)).digest('hex');
	return database.transaction(async (tx) => {
		// Serialize retries, and commit the mutation and its receipt together.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${principal.id + ':' + call.idempotencyKey}, 0))`
		);
		const [previous] = await tx
			.select()
			.from(agentOperation)
			.where(
				and(
					eq(agentOperation.principalId, principal.id),
					eq(agentOperation.idempotencyKey, call.idempotencyKey!)
				)
			);
		if (previous) {
			if (previous.inputHash !== inputHash)
				throw new HTTPException(409, {
					message: 'Idempotency key was already used with different arguments.',
				});
			return previous.result;
		}
		// An API key can be revoked while a request waits for a lock.
		if (!principal.id.startsWith('oauth:')) {
			const [key] = await tx
				.select()
				.from(agentKey)
				.where(and(eq(agentKey.id, principal.id), isNull(agentKey.revokedAt)));
			if (!key || key.expiresAt <= new Date())
				throw new HTTPException(401, {
					message: 'API key is no longer active.',
				});
		}
		const db = tx as unknown as Database;
		let path = call.path,
			verb = method,
			body = call.body;
		if (method === 'PATCH') {
			const id = call.path.split('/')[3]!;
			const isRequest = call.path.startsWith('/manage/requests/');
			const [existing] = isRequest
				? await tx
						.select()
						.from(request)
						.where(
							and(
								eq(request.id, id),
								eq(request.organizationId, principal.organizationId)
							)
						)
						.for('update')
				: await tx
						.select()
						.from(customer)
						.where(
							and(
								eq(customer.id, id),
								eq(customer.organizationId, principal.organizationId)
							)
						)
						.for('update');
			if (!existing)
				throw new HTTPException(404, { message: 'Record not found.' });
			if (
				existing.updatedAt.toISOString() !==
				new Date(call.expectedUpdatedAt!).toISOString()
			)
				throw new HTTPException(409, {
					message: 'This record changed. Read it again before updating.',
				});
			if (isRequest && !path.endsWith('/status')) {
				const patch = requestPatchInput.parse(body);
				if (!Object.keys(patch).length)
					throw new HTTPException(400, {
						message: 'Provide at least one field to update.',
					});
				const current = (await dispatch(db, path, 'GET')) as Record<
					string,
					unknown
				>;
				body = requestInput.parse({ ...current, ...patch });
				verb = 'PUT';
			}
		}
		const rawResult = await dispatch(db, path, verb, body);
		// Preserve millisecond precision and ensure even same-tick edits advance the version.
		if (method === 'PATCH' && path.startsWith('/manage/customers/')) {
			const row = rawResult as { id: string; updatedAt: string };
			const next = new Date(
				Math.max(Date.now(), new Date(call.expectedUpdatedAt!).getTime() + 1)
			);
			await tx
				.update(customer)
				.set({ updatedAt: next })
				.where(eq(customer.id, row.id));
			row.updatedAt = next.toISOString();
		}
		const result = compact(rawResult);
		const output = {
			data: result,
			effects:
				method !== 'GET' && path.includes('requests')
					? 'Request status changes may enqueue Slack notifications according to workspace settings.'
					: undefined,
		};
		await tx.insert(agentOperation).values({
			organizationId: principal.organizationId,
			principalId: principal.id,
			userId: principal.identity.userId,
			operation: `${method} ${call.path}`,
			idempotencyKey: call.idempotencyKey!,
			inputHash,
			result: output,
		});
		return output;
	});
}

export async function executeAgentCall(
	...args: Parameters<typeof executeAgentCallUnchecked>
) {
	try {
		return await executeAgentCallUnchecked(...args);
	} catch (error) {
		if (error instanceof z.ZodError)
			throw new HTTPException(400, {
				message: error.issues
					.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
					.join('; '),
			});
		throw error;
	}
}
