import { serve } from '@hono/node-server';
import { closeDb } from '@repo/db';
import { createHttpApp } from './http.js';

for (const name of [
	'DATABASE_URL',
	'APP_URL',
	'CLERK_SECRET_KEY',
	'CLERK_PUBLISHABLE_KEY',
]) {
	if (!process.env[name])
		throw new Error(`${name} is required by the API service.`);
}
const port = Number(process.env.PORT ?? 3101);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error('PORT must be an integer between 1 and 65535.');
const server = serve(
	{ fetch: createHttpApp().fetch, hostname: '::', port },
	() => {
		console.log(`Vows API listening on port ${port}`);
	}
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		const timeout = setTimeout(() => process.exit(1), 25000);
		timeout.unref();
		server.close(async (error) => {
			await closeDb();
			clearTimeout(timeout);
			process.exit(error ? 1 : 0);
		});
	});
}
