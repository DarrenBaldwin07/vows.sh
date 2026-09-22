import { Hono } from 'hono';
import { getDb, sql } from '@repo/db';

export function createHealthRoutes({
	checkDatabase = async () => {
		await getDb().execute(sql`select 1`);
	},
} = {}) {
	const routes = new Hono();
	routes.get('/health', async (c) => {
		c.header('Cache-Control', 'no-store');
		try {
			await checkDatabase();
			return c.json({ status: 'ok' });
		} catch {
			return c.json({ status: 'unavailable' }, 503);
		}
	});
	return routes;
}
