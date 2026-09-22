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
