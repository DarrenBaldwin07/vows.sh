// Run the suite against a disposable database, never against application data.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(
	new URL('../../../packages/db/package.json', import.meta.url)
);
const { Pool } = require('pg');
await import('../../../packages/db/dist/env.js');
const source = new URL(process.env.DATABASE_URL);
const name = `vows_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: source.href });
let code = 1;
try {
	await admin.query(`CREATE DATABASE "${name}"`);
	const target = new URL(source);
	target.pathname = `/${name}`;
	const env = {
		...process.env,
		DATABASE_URL: target.href,
		TEST_DATABASE_URL: target.href,
	};
	const migration = spawnSync('pnpm', ['--filter', '@repo/db', 'db:migrate'], {
		env,
		stdio: 'inherit',
	});
	if (migration.status !== 0) throw new Error('Test migration failed');
	const tests = spawnSync('pnpm', ['--filter', '@repo/api', 'test'], {
		env,
		stdio: 'inherit',
	});
	code = tests.status ?? 1;
} finally {
	await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	await admin.end();
}
process.exitCode = code;
