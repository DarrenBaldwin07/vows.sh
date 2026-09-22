import { serve } from '@hono/node-server';
import { app } from './app.js';
import { closeDb } from '@repo/db';

const server = serve(
	{ fetch: app.fetch, port: Number(process.env.PORT ?? 3002) },
	({ port }) => console.log(`API listening on http://localhost:${port}`)
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		server.close(() => {
			void closeDb().catch((error) => {
				console.error('Failed to close database connections', error);
				process.exitCode = 1;
			});
		});
	});
}
