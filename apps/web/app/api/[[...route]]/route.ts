import { auth, clerkClient } from '@clerk/nextjs/server';
import { resolveAgent, agentError, checkAgentOrigin } from '@/lib/agent-auth';
import { executeAgentCall } from '@repo/api/agent-service';
import { app } from '@repo/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
	if (request.headers.has('Authorization')) {
		try {
			checkAgentOrigin(request);
			const { principal, bindings } = await resolveAgent(request);
			const url = new URL(request.url);
			const body = ['GET', 'HEAD'].includes(request.method)
				? undefined
				: await request.json();
			const result = await executeAgentCall(
				principal,
				{
					path: url.pathname.slice(4) + url.search,
					method: request.method,
					body,
					idempotencyKey: request.headers.get('Idempotency-Key') ?? undefined,
					expectedUpdatedAt:
						request.headers.get('X-Expected-Updated-At') ?? undefined,
				},
				bindings
			);
			return Response.json(result, {
				headers: { 'Cache-Control': 'no-store' },
			});
		} catch (error) {
			return agentError(error, request);
		}
	}

	const session = await auth();
	if (!session.userId)
		return Response.json({ error: 'Sign in to continue.' }, { status: 401 });
	const client = await clerkClient();
	const user = new URL(request.url).pathname.startsWith('/api/portal/')
		? await client.users.getUser(session.userId)
		: null;
	return app.fetch(request, {
		identity: {
			userId: session.userId,
			organizationId: session.orgId ?? null,
			role: session.orgRole ?? null,
			verifiedEmails:
				user?.emailAddresses
					.filter((e) => e.verification?.status === 'verified')
					.map((e) => e.emailAddress.toLowerCase()) ?? [],
		},
		workspaceBranding: async (organizationId) => {
			const workspace = await client.organizations.getOrganization({
				organizationId,
			});
			return {
				name: workspace.name,
				imageUrl: workspace.imageUrl,
				hasImage: workspace.hasImage,
			};
		},
		portalAssignees: async (organizationId, userIds) => {
			const assignees: { id: string; name: string; imageUrl: string | null }[] =
				[];
			let offset = 0;
			while (true) {
				const page = await client.organizations.getOrganizationMembershipList({
					organizationId,
					limit: 100,
					offset,
				});
				for (const membership of page.data) {
					const info = membership.publicUserData;
					if (info?.userId && userIds.includes(info.userId)) {
						assignees.push({
							id: info.userId,
							name:
								[info.firstName, info.lastName].filter(Boolean).join(' ') ||
								'Team member',
							imageUrl: info.hasImage ? info.imageUrl : null,
						});
					}
				}
				offset += page.data.length;
				if (
					offset >= page.totalCount ||
					page.data.length === 0 ||
					assignees.length === userIds.length
				)
					break;
			}
			return assignees;
		},
		members: async () => {
			if (!session.orgId) return [];
			const members: { id: string; name: string; email: string }[] = [];
			let offset = 0;
			while (true) {
				const page = await client.organizations.getOrganizationMembershipList({
					organizationId: session.orgId,
					limit: 100,
					offset,
				});
				for (const membership of page.data) {
					const info = membership.publicUserData;
					if (info?.userId)
						members.push({
							id: info.userId,
							name:
								[info.firstName, info.lastName].filter(Boolean).join(' ') ||
								info.identifier,
							email: info.identifier,
						});
				}
				offset += page.data.length;
				if (offset >= page.totalCount || page.data.length === 0) break;
			}
			return members;
		},
	});
}
export {
	handle as GET,
	handle as POST,
	handle as PUT,
	handle as PATCH,
	handle as DELETE,
};
