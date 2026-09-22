# Vows MCP and bearer API access

Create a key in **Settings → Agent connections** while the desired workspace is active. Choose read-only or read/write, and an expiry. The complete key is shown once; only its SHA-256 hash is stored. Members manage their own keys; workspace admins can also revoke other members’ keys. Keys stop working when expired, revoked, or their owner is no longer a workspace member.

Connect an MCP client with Streamable HTTP:

```json
{
	"mcpServers": {
		"vows": {
			"url": "http://localhost:3100/mcp",
			"headers": {
				"Authorization": "Bearer YOUR_API_KEY"
			}
		}
	}
}
```

Use `http://localhost:3101/mcp` to connect directly to the API without Web, or replace the URL with your HTTPS deployment for remote clients. `localhost` works only for clients running on the same computer. Some clients use `httpHeaders` or require an explicit HTTP transport option instead; the server requires the actual `Authorization` header, never a query-string key. Keep the key in the client’s secret configuration rather than a committed project file.

The SDK v2 handler supports MCP 2026-07-28 and the stateless 2025-era HTTP handshake. Discovery and tool calls require authentication. This endpoint does not enable browser-session access or allow cross-origin browser calls. Non-browser clients can omit `Origin`; a supplied `Origin` must match `APP_URL`.

## Tools

| Tool                                  | Purpose                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `list_customers`                      | Active customers; `limit` and `offset` pagination                                 |
| `get_customer`                        | Customer details, including `updatedAt`                                           |
| `list_requests`                       | Requests filtered by `customerId`, `status`, or `assigneeId`                      |
| `get_request`                         | Request details, internal notes, history, and delivery state                      |
| `search`                              | Workspace search; narrow the query when `moreCustomers` or `moreRequests` is true |
| `list_members`                        | Valid assignee IDs and member names                                               |
| `create_customer` / `update_customer` | Create customers or change name/domain                                            |
| `create_request` / `update_request`   | Create or partially edit requests                                                 |
| `set_request_status`                  | Change status                                                                     |
| `assign_request`                      | Assign a member or use `null` to unassign                                         |

All tool definitions are discoverable with either scope; writes enforce read/write permission at execution. Lists return `items` and `nextOffset`; pass the latter as the next `offset`, until it is `null`. Stored customer images are omitted from agent results.

Every write requires `idempotencyKey`, a caller-generated string of 1–128 characters. Use a new key for each intended change and reuse the exact same arguments/key when retrying. Successful writes and their receipts commit in one transaction. Reusing a key with different arguments returns 409. Receipts are scoped to the connection and are retained until its workspace is deleted.

Every update also requires `expectedUpdatedAt`, copied from a fresh read. A conflict returns 409; read the record again and decide whether to retry with a new operation key. Omitted request fields are preserved, including Slack destinations and internal notes. Mutations are logged in `AgentOperation` with the user, connection, operation, input hash, timestamp, and result. Request status history retains the initiating user ID.

Changing a request to `done` can enqueue a Slack notification under the existing workspace/request rules. Reopening can cancel pending deliveries. No sharing, portal access, API-key management, Slack connection management, or explicit notification resend tools are exposed.

## REST with the same key

Bearer authentication is also supported on the corresponding `/api/manage` endpoints. It uses the same restricted agent adapter and the same permission, retry, and conflict rules, not the browser response contract for every endpoint.

```sh
curl http://localhost:3100/api/manage/customers \
  -H "Authorization: Bearer $VOWS_API_KEY"
```

Creation uses `POST`; partial edits use `PATCH`. Supply `Idempotency-Key` for every write, and `X-Expected-Updated-At` for updates. Request status updates use `PATCH /api/manage/requests/:id/status`. Assignee updates use `PATCH /api/manage/requests/:id` with `{"assigneeId":"user_..."}`. Write responses wrap the updated record in `data` and include a note about possible notification effects.

An optional `X-Organization-Id` must match the key’s workspace. Keys never follow the browser’s active organization.

## Optional Clerk OAuth

Bearer API keys work without any OAuth setup. The endpoint can alternatively authenticate Clerk OAuth access tokens when the deployment is configured:

1. Enable Clerk OAuth and advertise the custom `vows:read` and `vows:write` scopes. Write scope includes read access.
2. Configure compatible OAuth client registration and consent in Clerk.
3. Set `CLERK_OAUTH_ISSUER` in the API environment to the issuer from Clerk’s authorization-server metadata. Set `APP_URL` to the canonical HTTPS web origin.
4. Use `/mcp?workspace=CLERK_ORGANIZATION_ID` for OAuth connections. The workspace is explicit and current membership is checked on each HTTP request. No workspace IDs are accepted as tool arguments.

Discovery metadata is served at `/.well-known/oauth-protected-resource/mcp`. Without OAuth configuration, it returns 404 and 401 responses advertise only bearer API-key authentication. With configuration, 401 responses advertise the protected resource metadata URL. Revoke OAuth grants through Clerk; the Agent connections list manages Vows API keys only.

OAuth requires deployment/account configuration and has not been live-tested against a configured OAuth client. API keys and SDK protocol flows are covered by database integration tests.

## Development and checks

Build `@repo/db` and `@repo/api` after changing server code, then run `pnpm --filter @repo/api start`. The standalone API serves MCP directly on port 3101; Web proxies the public `/mcp` URL to it. Run migrations before starting the API.

```sh
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db build
pnpm --filter @repo/api build
pnpm --filter @repo/api check-types
pnpm lint
pnpm --filter @repo/api test:isolated
```

`test:isolated` creates a disposable database using the configured Postgres connection, migrates it, runs all API tests (including authorization, retries, concurrency, and real MCP SDK clients), and drops it afterward. It requires database-creation privileges. Alternatively set `TEST_DATABASE_URL` to an already-migrated dedicated test database and run `pnpm --filter @repo/api test`.
