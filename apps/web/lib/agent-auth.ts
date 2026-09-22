import { auth, clerkClient } from '@clerk/nextjs/server';
import { HTTPException } from 'hono/http-exception';
import { getDb, organization, eq } from '@repo/db';
import {
	authenticateAgentKey,
	type AgentPrincipal,
} from '@repo/api/agent-keys';
import type { Env } from '@repo/api/context';

export async function resolveAgent(
	request: Request
): Promise<{ principal: AgentPrincipal; bindings: Env['Bindings'] }> {
	const client = await clerkClient();
	async function membership(organizationId: string, userId: string) {
		const page = await client.organizations.getOrganizationMembershipList({
			organizationId,
			userId: [userId],
			limit: 1,
		});
		return (
			page.data.find((m) => m.publicUserData?.userId === userId)?.role ?? null
		);
	}
	const authorization = request.headers.get('Authorization');
	const expectedWorkspace =
		request.headers.get('X-Organization-Id') ??
		new URL(request.url).searchParams.get('workspace');
	let principal: AgentPrincipal;
	if (/^Bearer vows_/i.test(authorization ?? '')) {
		principal = await authenticateAgentKey(getDb(), authorization, membership);
		if (
			expectedWorkspace &&
			expectedWorkspace !== principal.identity.organizationId
		)
			throw new HTTPException(409, {
				message: 'This API key belongs to a different workspace.',
			});
	} else {
		if (!process.env.CLERK_OAUTH_ISSUER || !authorization)
			throw new HTTPException(401, {
				message: 'Send Authorization: Bearer <API_KEY>.',
			});
		const session = await auth({ acceptsToken: 'oauth_token' });
		if (!session.isAuthenticated || !session.userId)
			throw new HTTPException(401, { message: 'Invalid OAuth access token.' });
		if (!expectedWorkspace)
			throw new HTTPException(400, {
				message: 'Use the workspace-specific MCP URL from Settings.',
			});
		const role = await membership(expectedWorkspace, session.userId);
		if (!role)
			throw new HTTPException(403, {
				message: 'You are not a member of this workspace.',
			});
		const permission = session.scopes.includes('vows:write')
			? 'write'
			: session.scopes.includes('vows:read')
				? 'read'
				: null;
		if (!permission)
			throw new HTTPException(403, {
				message: 'This token needs vows:read or vows:write scope.',
			});
		await getDb()
			.insert(organization)
			.values({ clerkOrganizationId: expectedWorkspace })
			.onConflictDoNothing();
		const [org] = await getDb()
			.select()
			.from(organization)
			.where(eq(organization.clerkOrganizationId, expectedWorkspace));
		principal = {
			id: `oauth:${session.clientId}:${session.userId}:${org!.id}`,
			organizationId: org!.id,
			permission,
			identity: {
				userId: session.userId,
				organizationId: expectedWorkspace,
				role,
				verifiedEmails: [],
			},
		};
	}
	const bindings: Env['Bindings'] = {
		identity: principal.identity,
		members: async () => {
			const members: { id: string; name: string; email: string }[] = [];
			let offset = 0;
			while (true) {
				const page = await client.organizations.getOrganizationMembershipList({
					organizationId: principal.identity.organizationId!,
					limit: 100,
					offset,
				});
				for (const m of page.data)
					if (m.publicUserData?.userId)
						members.push({
							id: m.publicUserData.userId,
							name:
								[m.publicUserData.firstName, m.publicUserData.lastName]
									.filter(Boolean)
									.join(' ') || 'Team member',
							email: m.publicUserData.identifier,
						});
				offset += page.data.length;
				if (offset >= page.totalCount || page.data.length === 0) break;
			}
			return members;
		},
	};
	return { principal, bindings };
}
export function agentError(error: unknown, request: Request) {
	const status =
		error instanceof HTTPException
			? error.status
			: error instanceof SyntaxError
				? 400
				: 500;
	const message =
		error instanceof HTTPException
			? error.message
			: error instanceof SyntaxError
				? 'Invalid JSON body.'
				: 'Agent request failed. Please try again.';
	const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
	if (status === 401)
		headers['WWW-Authenticate'] = process.env.CLERK_OAUTH_ISSUER
			? `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', process.env.APP_URL ?? request.url)}"`
			: 'Bearer realm="vows"';
	return Response.json({ error: message }, { status, headers });
}
export function checkAgentOrigin(request: Request) {
	const origin = request.headers.get('Origin');
	if (origin && origin !== new URL(process.env.APP_URL ?? request.url).origin)
		throw new HTTPException(403, { message: 'Request origin is not allowed.' });
}
