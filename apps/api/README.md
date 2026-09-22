# Vows API and notification worker

Hono routes live in `src/app.ts` and are mounted by
`apps/web/app/api/[[...route]]/route.ts`. The Next.js adapter verifies Clerk sessions
and supplies identity via server-side Hono bindings. Never populate these bindings
from request headers or request bodies. Manager routes require an active Clerk
organization; customer routes check verified email access independently.

The API accepts same-origin JSON mutations. Manager requests include an expected
Clerk organization ID so a change of active workspace cannot silently redirect
an in-flight mutation to a different organization.

- `/api/manage/customers`: customer list and creation.
- `/api/manage/customers/:id`: customer detail, settings, and archive state.
- `/api/manage/customers/:id/requests`: request creation.
- `/api/manage/customers/:id/sharing`: share-link management (admin).
- `/api/manage/customers/:id/access`: customer email access (admin).
- `/api/manage/requests/:id`: request detail and edits.
- `/api/manage/requests/:id/status`: status transitions.
- `/api/manage/requests/:id/notify`: explicit notification resend.
- `/api/manage/integrations`: sanitized connection status.
- `/api/manage/slack/connect` and `/callback`: Slack OAuth (admin).
- `/api/portal/:token`: authenticated, read-only customer projection.

`src/worker.ts` delivers transactional outbox jobs. `pnpm --filter @repo/api dev`
runs the worker with file watching; `pnpm --filter @repo/api start` runs its build.
The worker runs automatically in root `pnpm dev` and must run alongside the web
app in production. See the root README for environment and Slack configuration.

Tests use `tsx --test`. Set `TEST_DATABASE_URL` to an already-migrated test database
to include API, authorization, and notification lifecycle tests. No live Slack
messages are sent by the tests.
