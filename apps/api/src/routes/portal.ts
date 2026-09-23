import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
	and,
	eq,
	desc,
	isNull,
	inArray,
	or,
	customer,
	organization,
	customerAccess,
	customerShareLink,
	portalPath,
	request,
} from '@repo/db';
import { identity, type Env, type ApiContext } from '../context.js';

export const portalRoutes = new Hono<Env>();
async function renderPortal(c: ApiContext) {
	const user = identity(c);
	const [link] = c.req.param('workspace')
		? await c
				.get('db')
				.select({ customerId: customerShareLink.customerId })
				.from(portalPath)
				.innerJoin(
					customerShareLink,
					eq(portalPath.shareLinkId, customerShareLink.id)
				)
				.where(
					and(
						eq(
							portalPath.path,
							`/share/${c.req.param('workspace')}/${c.req.param('customer')}`
						),
						isNull(customerShareLink.revokedAt)
					)
				)
		: await c
				.get('db')
				.select({ customerId: customerShareLink.customerId })
				.from(customerShareLink)
				.where(
					and(
						eq(customerShareLink.token, c.req.param('token')!),
						isNull(customerShareLink.revokedAt)
					)
				);
	if (!link)
		throw new HTTPException(404, {
			message: 'This link is unavailable. Ask your contact for a new link.',
		});
	const [access] = user.verifiedEmails.length
		? await c
				.get('db')
				.select()
				.from(customerAccess)
				.where(
					and(
						eq(customerAccess.customerId, link.customerId),
						isNull(customerAccess.revokedAt),
						or(
							isNull(customerAccess.clerkUserId),
							eq(customerAccess.clerkUserId, user.userId)
						),
						inArray(
							customerAccess.email,
							user.verifiedEmails.map((e) => e.toLowerCase())
						)
					)
				)
		: [];
	if (!access || (access.clerkUserId && access.clerkUserId !== user.userId))
		throw new HTTPException(403, {
			message:
				'This account does not have access. Sign in with an invited, verified email or ask your contact to add you.',
		});
	await c
		.get('db')
		.update(customerAccess)
		.set({ clerkUserId: user.userId })
		.where(
			and(eq(customerAccess.id, access.id), isNull(customerAccess.clerkUserId))
		);
	const [owner] = await c
		.get('db')
		.select({
			name: customer.name,
			imageData: customer.imageData,
			archivedAt: customer.archivedAt,
			clerkOrganizationId: organization.clerkOrganizationId,
		})
		.from(customer)
		.innerJoin(organization, eq(customer.organizationId, organization.id))
		.where(eq(customer.id, link.customerId));
	if (!owner || owner.archivedAt)
		throw new HTTPException(404, { message: 'This portal is unavailable.' });
	const rows = await c
		.get('db')
		.select({
			id: request.id,
			title: request.title,
			description: request.description,
			status: request.status,
			updatedAt: request.updatedAt,
			completedAt: request.completedAt,
			completionNote: request.completionNote,
			assigneeId: request.assigneeId,
		})
		.from(request)
		.where(eq(request.customerId, link.customerId))
		.orderBy(desc(request.updatedAt));
	const assigneeIds = [
		...new Set(rows.flatMap((row) => (row.assigneeId ? [row.assigneeId] : []))),
	];
	const assignees = assigneeIds.length
		? ((await c.env.portalAssignees?.(
				owner.clerkOrganizationId,
				assigneeIds
			)) ?? [])
		: [];
	const assigneeById = new Map(
		assignees.map(({ id, name, imageUrl }) => [id, { name, imageUrl }])
	);
	const workspace =
		(await c.env
			.workspaceBranding?.(owner.clerkOrganizationId)
			.catch(() => null)) ?? null;
	return c.json({
		customer: { name: owner.name, imageData: owner.imageData },
		workspace,
		requests: rows.map(({ assigneeId, ...row }) => ({
			...row,
			assignee: assigneeId ? (assigneeById.get(assigneeId) ?? null) : null,
		})),
	});
}
portalRoutes.get('/portal/:workspace/:customer', renderPortal);
portalRoutes.get('/portal/:token', renderPortal);
