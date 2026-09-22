import { auth, clerkClient } from '@clerk/nextjs/server';
import { app } from '@repo/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
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
