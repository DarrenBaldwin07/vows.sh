import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { agentKey, and, eq, desc } from '@repo/db';
import { identity, type Env } from '../context.js';
import { newAgentKey, hashAgentKey } from '../agent-keys.js';

export const agentKeyRoutes = new Hono<Env>();
agentKeyRoutes.get('/', async (c) => {
	const user = identity(c);
	return c.json(
		await c
			.get('db')
			.select({
				id: agentKey.id,
				name: agentKey.name,
				prefix: agentKey.prefix,
				permission: agentKey.permission,
				createdAt: agentKey.createdAt,
				expiresAt: agentKey.expiresAt,
				lastUsedAt: agentKey.lastUsedAt,
				revokedAt: agentKey.revokedAt,
				userId: agentKey.userId,
			})
			.from(agentKey)
			.where(
				and(
					eq(agentKey.organizationId, c.get('organizationId')),
					...(user.role === 'org:admin'
						? []
						: [eq(agentKey.userId, user.userId)])
				)
			)
			.orderBy(desc(agentKey.createdAt))
	);
});
agentKeyRoutes.post('/', async (c) => {
	const data = z
		.object({
			name: z.string().trim().min(1).max(80),
			permission: z.enum(['read', 'write']).default('read'),
			expiresInDays: z.number().int().min(1).max(365).default(90),
		})
		.parse(await c.req.json());
	const token = newAgentKey();
	const [key] = await c
		.get('db')
		.insert(agentKey)
		.values({
			organizationId: c.get('organizationId'),
			userId: identity(c).userId,
			name: data.name,
			permission: data.permission,
			prefix: token.slice(0, 12),
			tokenHash: hashAgentKey(token),
			expiresAt: new Date(Date.now() + data.expiresInDays * 86400000),
		})
		.returning({
			id: agentKey.id,
			name: agentKey.name,
			expiresAt: agentKey.expiresAt,
		});
	return c.json({ ...key, token }, 201);
});
agentKeyRoutes.delete('/:id', async (c) => {
	const user = identity(c);
	const [row] = await c
		.get('db')
		.update(agentKey)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(agentKey.id, c.req.param('id')),
				eq(agentKey.organizationId, c.get('organizationId')),
				...(user.role === 'org:admin' ? [] : [eq(agentKey.userId, user.userId)])
			)
		)
		.returning({ id: agentKey.id });
	if (!row) throw new HTTPException(404, { message: 'API key not found.' });
	return c.json({ revoked: true });
});
