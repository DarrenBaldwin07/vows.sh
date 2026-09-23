import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
	and,
	eq,
	isNull,
	organization,
	customer,
	customerShareLink,
	portalWorkspace,
	portalPath,
} from '@repo/db';
import { getCustomer, type ApiContext } from '../context.js';
import { newToken } from '../slack.js';

export const portalSlugInput = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(60)
	.regex(
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
		'Use lowercase letters, numbers, and single hyphens.'
	);
export const portalAddressInput = z.object({
	workspaceSlug: portalSlugInput,
	customerSlug: portalSlugInput,
});
export function readableSlug(value: string, fallback: string) {
	return (
		value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 50)
			.replace(/-$/, '') || fallback
	);
}
export async function publishPortalLink(
	c: ApiContext,
	customerId: string,
	options: {
		rotate?: boolean;
		address?: z.infer<typeof portalAddressInput>;
	} = {}
) {
	const owner = await getCustomer(c, customerId);
	const db = c.get('db');
	const [initialOrg] = await db
		.select()
		.from(organization)
		.where(eq(organization.id, owner.organizationId));
	const branding =
		!initialOrg?.portalSlug && !options.address
			? await c.env.workspaceBranding?.(initialOrg!.clerkOrganizationId)
			: undefined;
	return db.transaction(async (tx) => {
		const [org] = await tx
			.select()
			.from(organization)
			.where(eq(organization.id, owner.organizationId))
			.for('update');
		await tx
			.select()
			.from(customer)
			.where(eq(customer.id, owner.id))
			.for('update');
		let [link] = await tx
			.select()
			.from(customerShareLink)
			.where(
				and(
					eq(customerShareLink.customerId, owner.id),
					isNull(customerShareLink.revokedAt)
				)
			);
		if (!options.rotate && !link) {
			if (options.address)
				throw new HTTPException(400, {
					message: 'Enable sharing before editing the link.',
				});
			return null;
		}
		if (options.rotate) {
			await tx
				.update(customerShareLink)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(customerShareLink.customerId, owner.id),
						isNull(customerShareLink.revokedAt)
					)
				);
			[link] = await tx
				.insert(customerShareLink)
				.values({ customerId: owner.id, token: newToken() })
				.returning();
		}
		if (link!.path && !options.address) return link!;
		let workspaceSlug = options.address?.workspaceSlug ?? org!.portalSlug;
		const base =
			workspaceSlug ?? readableSlug(branding?.name ?? '', 'workspace');
		for (let suffix = 1; ; suffix++) {
			const candidate = suffix === 1 ? base : `${base.slice(0, 50)}-${suffix}`;
			await tx
				.insert(portalWorkspace)
				.values({ slug: candidate, organizationId: owner.organizationId })
				.onConflictDoNothing();
			const [claim] = await tx
				.select()
				.from(portalWorkspace)
				.where(eq(portalWorkspace.slug, candidate));
			if (claim!.organizationId === owner.organizationId) {
				workspaceSlug = candidate;
				break;
			}
			if (options.address)
				throw new HTTPException(409, {
					message: 'That workspace URL name is already taken.',
				});
		}
		await tx
			.update(organization)
			.set({ portalSlug: workspaceSlug })
			.where(eq(organization.id, owner.organizationId));
		const customerBase =
			options.address?.customerSlug ?? readableSlug(owner.name, 'customer');
		let path: string;
		for (let suffix = 1; ; suffix++) {
			const name =
				suffix === 1 ? customerBase : `${customerBase.slice(0, 50)}-${suffix}`;
			path = `/share/${workspaceSlug}/${name}`;
			await tx
				.insert(portalPath)
				.values({ path, shareLinkId: link!.id })
				.onConflictDoNothing();
			const [alias] = await tx
				.select()
				.from(portalPath)
				.where(eq(portalPath.path, path));
			if (alias!.shareLinkId === link!.id) break;
			if (options.address)
				throw new HTTPException(409, {
					message: 'That customer URL is already in use. Choose another name.',
				});
		}
		const [updated] = await tx
			.update(customerShareLink)
			.set({ path })
			.where(eq(customerShareLink.id, link!.id))
			.returning();
		return updated!;
	});
}
