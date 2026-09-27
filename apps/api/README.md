# Vows API

A standalone Hono HTTP server. It runs independently of Next.js and owns Clerk
verification, authorization, customer data, Slack OAuth, REST, and MCP.

```sh
# From the repository root, after configuring .env and applying migrations:
pnpm exec turbo run build --filter=@repo/api
pnpm --filter @repo/api start
```

The API listens on `PORT` (default **3101**) on IPv4 and IPv6. `GET /health`
returns 200 when Postgres is reachable and 503 otherwise. SIGTERM stops accepting
requests and closes the database pool after in-flight requests finish.

Use `pnpm --filter @repo/api dev` for the API alone, or root `pnpm dev` for the
web app, API, notification worker, and docs app together. The worker has its own
entry point: `pnpm --filter @repo/api start:worker` runs `dist/run-worker.js`.
Starting the HTTP server never starts the worker.

## Layout

- `src/index.ts`: HTTP listener and process lifecycle.
- `src/http.ts`: transport middleware and public router assembly.
- `src/app.ts`: authenticated application router and shared authorization.
- `src/routes/`: all HTTP handlers, grouped by feature: customers, requests,
  sharing, portal, search, members, integrations, Slack, agent keys, MCP, OAuth,
  health, and the authenticated API dispatcher.
- `src/services/requests.ts`: transactional request updates and notification jobs.
- `src/clerk.ts`, `src/agent-auth.ts`: server-side credential verification.
- `src/worker.ts`, `src/run-worker.ts`: notification delivery and polling process.

## Application routes

The browser API accepts same-origin JSON mutations. Manager requests include an expected
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

See [MCP and bearer authentication](MCP.md) for agent tools, OAuth setup, and retry semantics.

## Environment

The root `.env` is loaded for local development; process variables take precedence.
Required: `DATABASE_URL`, `APP_URL` (the public **web** origin),
`CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. The Clerk instance must match Web.
Slack additionally uses `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and a stable
`INTEGRATION_ENCRYPTION_KEY`. Clerk OAuth for agents optionally uses
`CLERK_OAUTH_ISSUER`.

Web proxies `/api/*`, `/mcp`, and `/.well-known/oauth-protected-resource/mcp` to
this service over HTTP. These are URL rewrites, not Next.js route handlers.
The API verifies the session cookie itself and checks mutations against `APP_URL`.
Forwarded host/protocol headers are replaced with the configured origin; user IDs,
roles, and organizations are never trusted from client headers.

Agent REST and MCP requests use bearer API keys or configured Clerk OAuth tokens.
They can call this HTTP server directly, without running Web. For example:

```sh
curl http://localhost:3101/api/manage/customers \
  -H "Authorization: Bearer $VOWS_API_KEY"
```

Keep `APP_URL` set to the public web origin for Slack redirects and generated links.
On Railway only Web needs a public domain; its `API_URL` points at the API's
private hostname and port 3101. API owns migrations and its database healthcheck.

## Verification

`pnpm --filter @repo/api test:isolated` creates a disposable Postgres database,
applies migrations, runs the full suite, and removes the test database. It covers
workspace isolation, portal access, agent scopes, delivery behavior, and standalone
HTTP authentication. Slack calls are stubbed and do not send real messages.

Customer portal links use `/share/<workspace>/<customer>` in the web app and
`/api/portal/<workspace>/<customer>` in the API. Share portal creates readable
names automatically and lets admins edit them. Names are stable across customer
renames; old readable aliases and legacy `/share/<token>` links retain the same
verified-email authorization. Replacing or disabling a link revokes its token
and every readable alias. Previously used paths are reserved, so re-enabling
sharing generates a fresh URL instead of reactivating revoked links.

## Linear issue sync

Workspace admins can connect Linear on **Integrations** using a read-only personal
API key. The key must be able to read the teams whose issues will be linked.
Credentials are encrypted with the existing `INTEGRATION_ENCRYPTION_KEY`.

After connecting, create an **Issues** webhook in Linear Settings → API. Copy the
workspace-specific URL shown in Vows and save Linear's signing secret in Vows.
Select every team you want to sync. No new deployment environment variables are
required. See [Linear's API authentication](https://linear.app/developers/graphql)
and [webhook setup](https://linear.app/developers/webhooks).

Save a request, then paste an existing Linear issue URL into its Linear section.
Linking reads its current state and applies it immediately. Later issue changes
are verified using HMAC-SHA256 over the raw body, a one-minute delivery timestamp
window, and the connected Linear organization ID. The HTTP endpoint persists the
notification before acknowledging it; the existing Worker processes the queue
on its five-second loop. Older issue versions and repeated deliveries do not
repeat status changes or completion notifications. Webhooks must reach Web's
public `/api/webhooks/linear/:integrationId` route, which proxies to API and does
not require a Clerk session or browser Origin header.

Status mapping: triage/backlog/unstarted → Todo, started → In progress,
started states named Review or In review → In review, completed → Done,
canceled → Canceled. Unknown types are rejected. Sync is one-way. Non-status
Linear edits do not overwrite a manual Vows status change. A synced Done status
uses the same Slack completion policy as a manual change. Archived customers
are not updated. Unlinking or disconnecting stops future sync; disconnecting
clears credentials. Reconnecting to another Linear workspace removes old links.

## Request audit history

`RequestEvent` records creation, status and field changes, Slack/Linear linking,
Linear sync activity, and notification delivery transitions. Request mutations
and their events commit together. A database trigger records delivery transitions
across worker retries, cancellations, failures, and successful sends. Browser,
portal, agent, and Linear updates identify their source.

Team members use `/api/manage/requests/:id/events`; customers use
`/api/portal/:token/requests/:id/events` or the readable portal equivalent.
Both support a `cursor` and return up to 50 events, newest first. Portal history
reuses portal authorization and verifies request ownership. It excludes private
internal-note/preference events and delivery failures, and explicitly projects
safe metadata: no raw before/after values, actor IDs, private URLs, or errors.
The team timeline retains full before/after values.

Existing status history is preserved by the migration. Earlier field edits were
not recorded and cannot be reconstructed; detailed auditing starts with this
release. API integration test files run serially because their workers consume
from a shared disposable database queue.
