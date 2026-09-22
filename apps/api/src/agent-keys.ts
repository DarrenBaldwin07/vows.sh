import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import {
	agentKey,
	organization,
	and,
	eq,
	isNull,
	type Database,
} from '@repo/db';
import { type Identity } from './context.js';

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
