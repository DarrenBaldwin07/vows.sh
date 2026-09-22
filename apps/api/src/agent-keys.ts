import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
	agentKey,
	organization,
	and,
	eq,
	isNull,
	desc,
	type Database,
} from '@repo/db';
import { identity, type Env, type Identity } from './context.js';

export function hashAgentKey(token: string) {
	return createHash('sha256').update(token).digest('hex');
}
export function newAgentKey() {
	return `vows_${randomBytes(32).toString('base64url')}`;
}
export type AgentPrincipal = {
	id: string;
	organizationId: string;
	permission: 'read' | 'write';
	identity: Identity;
};
export async function authenticateAgentKey(
	database: Database,
	header: string | null,
	membership: (organizationId: string, userId: string) => Promise<string | null>
): Promise<AgentPrincipal> {
	const match = /^Bearer (vows_[A-Za-z0-9_-]{43})$/i.exec(header ?? '');
	const deny = () =>
		new HTTPException(401, {
			message: 'Invalid, expired, or revoked API key.',
		});
	if (!match) throw deny();
	const [row] = await database
		.select({
			key: agentKey,
			clerkOrganizationId: organization.clerkOrganizationId,
		})
		.from(agentKey)
		.innerJoin(organization, eq(agentKey.organizationId, organization.id))
		.where(
			and(
				eq(agentKey.tokenHash, hashAgentKey(match[1]!)),
				isNull(agentKey.revokedAt)
			)
		);
	if (!row || row.key.expiresAt <= new Date()) throw deny();
	const role = await membership(row.clerkOrganizationId, row.key.userId);
	if (!role) throw deny();
	await database
		.update(agentKey)
		.set({ lastUsedAt: new Date() })
		.where(eq(agentKey.id, row.key.id));
	return {
		id: row.key.id,
		organizationId: row.key.organizationId,
		permission: row.key.permission,
		identity: {
			userId: row.key.userId,
			organizationId: row.clerkOrganizationId,
			role,
			verifiedEmails: [],
		},
	};
}
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
