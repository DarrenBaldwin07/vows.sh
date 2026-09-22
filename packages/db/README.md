# @repo/db

Shared server-side Drizzle package for PostgreSQL.

- `src/schema.ts`: the example `greetings` table.
- `src/index.ts`: lazy `getDb()` connection pool and `closeDb()` for shutdown.
- `drizzle/`: generated SQL migrations and schema snapshots.
- `drizzle.config.ts`: schema, migration directory, and connection settings.
- `src/seed.ts`: repeatable hello-world seed.

Import `getDb` and `greetings` from `@repo/db`, or schema definitions from
`@repo/db/schema`. Use `import type` when only TypeScript types are needed.
The runtime entry point is server-only; browser components should use the API.

See the root README for Docker Compose setup and migration commands. Run root
`pnpm dev` or `pnpm build` to build this package before its consumers. If running
an app directly, first run `pnpm --filter @repo/db build`.
