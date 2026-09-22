import { closeDb, getDb, greetings } from './index.js';

try {
	await getDb()
		.insert(greetings)
		.values({ id: 'hello', message: 'Hello world!' })
		.onConflictDoNothing();
	console.log('Hello-world greeting seeded.');
} finally {
	await closeDb();
}
