import { processLinearWebhooks } from './services/linear-sync.js';
import { closeDb } from '@repo/db';
import { deliverNotifications } from './worker.js';
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
	process.once(signal, () => {
		stopped = true;
	});
while (!stopped) {
	try {
		await processLinearWebhooks();
	} catch (error) {
		console.error(
			'Linear sync failed',
			error instanceof Error ? error.name : 'Unknown error'
		);
	}
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
