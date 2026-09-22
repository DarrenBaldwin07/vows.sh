import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getDatabaseUrl } from './env.js';
import * as schema from './schema.js';

export * from './schema.js';
export {
	and,
	eq,
	desc,
	asc,
	isNull,
	inArray,
	sql,
	count,
	ne,
	or,
	lte,
} from 'drizzle-orm';
export type Database = ReturnType<typeof getDb>;

function createDatabase() {
	const pool = new Pool({
		connectionString: getDatabaseUrl(),
		connectionTimeoutMillis: 5000,
	});
	pool.on('error', (error) =>
		console.error('Idle database connection failed', error)
	);
	return { pool, db: drizzle(pool, { schema }) };
}

// Reuse the pool across Next.js development reloads. Connect only on first use.
const globalDb = globalThis as typeof globalThis & {
	companyDatabase?: ReturnType<typeof createDatabase>;
};

export function getDb() {
	globalDb.companyDatabase ??= createDatabase();
	return globalDb.companyDatabase.db;
}

export async function closeDb() {
	const connection = globalDb.companyDatabase;
	delete globalDb.companyDatabase;
	await connection?.pool.end();
}
