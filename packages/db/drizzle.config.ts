import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './src/env.js';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema.ts',
	out: './drizzle',
	dbCredentials: { url: getDatabaseUrl() },
});
