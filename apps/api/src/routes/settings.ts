import { Hono } from 'hono';
import { eq, organization } from '@repo/db';
import { admin, type Env } from '../context.js';
import { workspaceSettingsInput } from '../validation.js';

export const settingsRoutes = new Hono<Env>();
settingsRoutes.get('/manage/settings', async (c) => {
	admin(c);
	const [settings] = await c
		.get('db')
		.select({ internalDomain: organization.internalDomain })
		.from(organization)
		.where(eq(organization.id, c.get('organizationId')));
	return c.json(settings!);
});
settingsRoutes.patch('/manage/settings', async (c) => {
	admin(c);
	const data = workspaceSettingsInput.parse(await c.req.json());
	const [settings] = await c
		.get('db')
		.update(organization)
		.set(data)
		.where(eq(organization.id, c.get('organizationId')))
		.returning({ internalDomain: organization.internalDomain });
	return c.json(settings!);
});
