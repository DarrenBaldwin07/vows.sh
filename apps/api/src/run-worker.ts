import { closeDb } from '@repo/db';
import { deliverNotifications } from './worker.js';
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
	process.once(signal, () => {
		stopped = true;
	});
while (!stopped) {
	try {
		await deliverNotifications();
	} catch (error) {
		console.error(
			'Notification worker failed',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
	if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5000));
}
await closeDb();
