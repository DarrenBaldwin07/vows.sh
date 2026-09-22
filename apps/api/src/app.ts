import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb } from '@repo/db';

export const app = new Hono()
	.use('*', cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }))
	.get('/hello', async (c) => {
		const greeting = await getDb().query.greetings.findFirst({
			where: (greetings, { eq }) => eq(greetings.id, 'hello'),
		});
		if (!greeting) {
			return c.json({ error: 'Greeting not found. Run pnpm db:seed.' }, 404);
		}
		return c.json({ message: greeting.message });
	});

export type AppType = typeof app;
