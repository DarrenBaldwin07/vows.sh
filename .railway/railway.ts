import {
	defineRailway,
	github,
	postgres,
	preserve,
	project,
	service,
} from 'railway/iac';

export default defineRailway(() => {
	const database = postgres('Postgres');
	const source = github('DarrenBaldwin07/vows.sh', { branch: 'main' });
	const runtime = {
		NODE_ENV: 'production',
		RAILPACK_NODE_VERSION: '24',
		// The pre-deploy migration command needs drizzle-kit at runtime.
		RAILPACK_PRUNE_DEPS: 'false',
	};
	const web = service('Web', {
		source,
		build: { builder: 'RAILPACK', buildCommand: 'pnpm build:railway:web' },
		start:
			'node apps/web/node_modules/next/dist/bin/next start apps/web --hostname 0.0.0.0',
		healthcheck: '/health',
		healthcheckTimeout: 120,
		deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 },
		env: {
			...runtime,
			PORT: '3000',
			APP_URL: preserve(),
			API_URL: 'http://${{API.RAILWAY_PRIVATE_DOMAIN}}:3101',
			NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: preserve(),
			NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
			NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
			CLERK_SECRET_KEY: preserve(),
		},
	});
	const api = service('API', {
		source,
		build: { builder: 'RAILPACK', buildCommand: 'pnpm build:railway:api' },
		start: 'node apps/api/dist/index.js',
		preDeploy: 'pnpm db:migrate',
		healthcheck: '/health',
		healthcheckTimeout: 120,
		deploy: {
			restartPolicyType: 'ON_FAILURE',
			restartPolicyMaxRetries: 10,
			drainingSeconds: 30,
		},
		env: {
			...runtime,
			PORT: '3101',
			DATABASE_URL: database.env.DATABASE_URL,
			APP_URL: web.env.APP_URL,
			CLERK_PUBLISHABLE_KEY: web.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
			CLERK_SECRET_KEY: web.env.CLERK_SECRET_KEY,
			INTEGRATION_ENCRYPTION_KEY: preserve(),
			SLACK_CLIENT_ID: preserve(),
			SLACK_CLIENT_SECRET: preserve(),
			CLERK_OAUTH_ISSUER: preserve(),
		},
	});
	const worker = service('Worker', {
		source,
		build: { builder: 'RAILPACK', buildCommand: 'pnpm build:railway:worker' },
		start: 'node apps/api/dist/run-worker.js',
		deploy: {
			restartPolicyType: 'ON_FAILURE',
			restartPolicyMaxRetries: 10,
			sleepApplication: false,
			drainingSeconds: 30,
		},
		env: {
			...runtime,
			APP_URL: web.env.APP_URL,
			DATABASE_URL: database.env.DATABASE_URL,
			INTEGRATION_ENCRYPTION_KEY: api.env.INTEGRATION_ENCRYPTION_KEY,
		},
	});
	return project('Vows', { resources: [database, web, api, worker] });
});
