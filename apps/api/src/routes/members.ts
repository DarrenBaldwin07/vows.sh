import { Hono } from 'hono';
import { type Env } from '../context.js';

export const membersRoutes = new Hono<Env>();
membersRoutes.get('/manage/members', async (c) =>
	c.json((await c.env.members?.()) ?? [])
);
