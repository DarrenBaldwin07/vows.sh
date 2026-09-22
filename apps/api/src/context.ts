import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { customer, organization, and, eq, type Database } from '@repo/db';
export type Member = { id: string; name: string; email: string };
export type Identity = {
	userId: string;
	organizationId: string | null;
	role: string | null;
	verifiedEmails: string[];
};
export type Env = {
	Bindings: { identity?: Identity; members?: () => Promise<Member[]> };
	Variables: { db: Database; organizationId: string };
};
export type ApiContext = Context<Env>;
export function identity(c: ApiContext) {
	const user = c.env?.identity;
	if (!user) throw new HTTPException(401, { message: 'Sign in to continue.' });
	return user;
}
export function admin(c: ApiContext) {
	if (identity(c).role !== 'org:admin')
		throw new HTTPException(403, {
			message: 'Only workspace admins can do this.',
		});
}
export async function ensureOrganization(c: ApiContext) {
	const user = identity(c);
	if (!user.organizationId)
		throw new HTTPException(403, {
			message: 'Select a workspace to continue.',
		});
	const expected =
		c.req.header('X-Organization-Id') ?? c.req.query('organizationId');
	if (expected && expected !== user.organizationId)
		throw new HTTPException(409, {
			message: 'Your workspace changed. Refresh and try again.',
		});
	const db = c.get('db');
	await db
		.insert(organization)
		.values({ clerkOrganizationId: user.organizationId })
		.onConflictDoNothing();
	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.clerkOrganizationId, user.organizationId));
	c.set('organizationId', org!.id);
}
export async function getCustomer(c: ApiContext, customerId: string) {
	const [row] = await c
		.get('db')
		.select()
		.from(customer)
		.where(
			and(
				eq(customer.id, customerId),
				eq(customer.organizationId, c.get('organizationId'))
			)
		);
	if (!row) throw new HTTPException(404, { message: 'Customer not found.' });
	return row;
}
