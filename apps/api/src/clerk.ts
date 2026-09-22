import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { Env } from './context.js';

let client: ClerkClient | undefined;
export function clerkClient() {
	return (client ??= createClerkClient({
		secretKey: process.env.CLERK_SECRET_KEY,
		publishableKey:
			process.env.CLERK_PUBLISHABLE_KEY ??
			process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
	}));
}

export async function sessionBindings(
	request: Request,
	client = clerkClient()
): Promise<Env['Bindings'] | Response> {
	const state = await client.authenticateRequest(request, {
		acceptsToken: 'session_token',
		authorizedParties: [new URL(process.env.APP_URL!).origin],
	});
	const session = state.toAuth();
	if (!session?.userId) {
		return Response.json(
			{ error: 'Sign in to continue.' },
			{ status: 401, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	const user = new URL(request.url).pathname.startsWith('/api/portal/')
		? await client.users.getUser(session.userId)
		: null;
	return {
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
	};
}
