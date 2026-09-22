import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Both src/ and dist/ resolve to the workspace root. Shell variables take priority.
config({
	path: fileURLToPath(new URL('../../../.env', import.meta.url)),
	quiet: true,
});

export function getDatabaseUrl() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			'DATABASE_URL is required. Copy .env.example to .env at the repo root.'
		);
	}
	return url;
}
