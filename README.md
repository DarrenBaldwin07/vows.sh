# vows.sh

the customer success agent. make vows to your customers.

Vows helps you track customer requests and keep customers updated through a private
portal where they can follow progress and see what’s been delivered. Connect
integrations like Slack to automatically notify customers in the original thread
when their vows go live.

[![Deploy on Railway](https://railway.com/button.svg)](#deploy-on-railway)

## Deploy on Railway

The repository includes a Railway configuration for separate Web, API, Worker, and Postgres
services, with automatic migrations and an API database healthcheck.
Bring your own Clerk keys; Slack integration is optional.

**One-click template activation is pending.** The button currently opens this
section. Follow the [Railway deployment guide](.railway/README.md) to deploy now
or finish creating the shareable template.

## Local development

Use Node 24+ and pnpm 11.25.0.

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` if it doesn't already exist.
3. Configure the same Clerk instance in both places: `CLERK_PUBLISHABLE_KEY`
   and `CLERK_SECRET_KEY` in the root `.env` for the API, and
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in
   `apps/web/.env.local` for the web app (see `apps/web/.env.example`).
4. In Clerk, enable **Organizations**, choose **membership optional**, and allow
   users to create organizations. Keep the default `org:admin` / `org:member`
   roles. Enable email verification for portal users. Organization membership is
   required by Vows for manager screens, but never for customer portals.
5. Run `pnpm db:up`, then `pnpm db:migrate`.
6. Run `pnpm dev` and open http://localhost:3100.

`pnpm dev` starts the web app (3100), standalone Hono HTTP API (3101),
notification worker, and docs app. `apps/api/src/index.ts` owns the HTTP server;
all API route handlers live in `apps/api/src/routes/`. The API verifies Clerk
sessions and agent credentials itself and owns database access.

Next.js only proxies `/api/*`, `/mcp`, and OAuth discovery to `API_URL`
(default `http://127.0.0.1:3101`). There are no Next.js API handlers or backend
package imports. Keeping browser requests on the web origin preserves session
cookies, CSRF protection, and Slack callbacks. The API also accepts direct HTTP
requests on its own port; an API key can be used without the web process.
No demo customer data is seeded. Sign in, create a workspace, and add a customer.

## Customer sharing

An admin opens a customer, chooses **Share portal**, adds allowed email addresses,
and enables sharing. Copy the link and send it to those people; adding an email
does not send an invitation. Customers must sign in using an allowed verified
email. A link alone never grants access.

The same link can be copied later. Replacing it invalidates the previous link;
removing an email revokes access; archiving a customer disables the portal.
Internal notes, assignments, Slack links, and delivery logs stay private.
Portal data refreshes every 30 seconds and on window focus.

## Slack setup

1. Create a Slack app with the bot scope `chat:write`.
2. Enable OAuth distribution for installation outside your development workspace.
3. Set the redirect URL to `https://YOUR_HOST/api/manage/slack/callback`.
   For local OAuth testing, use an HTTPS tunnel and set `APP_URL` to that origin.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `APP_URL` in the root `.env`
   (or the deployment environment).
5. Generate a key with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   and set `INTEGRATION_ENCRYPTION_KEY` on both the API and worker. Keep this
   key stable: changing it requires reconnecting Slack integrations.
6. A Vows admin connects Slack in **Integrations** and enables completion updates.
7. Add the Vows bot to the channel containing the customer's original request.
   Paste the original message permalink into the Vows request. For a reply link,
   the URL must contain the root `thread_ts`; otherwise use the root message link.

Only public/private channels accessible to the installed bot are supported.
The customer must already be in the conversation (including Slack Connect where
app access permits). Slack is a notification integration, not a request source.

Completion creates a transactional delivery job. The worker checks the request,
customer, connection, and notification settings again before posting. Rate
limits are retried, up to five attempts. Unknown delivery outcomes are marked
**Uncertain**, since blindly retrying a timeout can duplicate a Slack message.
Managers can inspect the thread and explicitly resend from request details.
Reopening and completing an already-notified request does not automatically resend.

## Deployment

Run `pnpm build`, apply migrations with `pnpm db:migrate`, then run:

- Web: `pnpm --filter web start`
- API HTTP server: `pnpm --filter @repo/api start`
- Background worker: `pnpm --filter @repo/api start:worker`

The API and worker share `DATABASE_URL`, `APP_URL`, and the integration encryption
key. Web and API use the same Clerk instance; only the API needs Slack OAuth
credentials and `CLERK_OAUTH_ISSUER`. The web app needs `API_URL` at build time
and runtime, pointing to the API service (use Railway's private network). It
does not need database or integration credentials. Run migrations before
starting the API. Deploy the API and worker as separate persistent Node processes.
See the [Railway guide](.railway/README.md) for the four-service configuration.
Jobs use Postgres row locking, so multiple worker instances are supported.
Disconnecting Slack disables delivery locally and removes stored credentials;
the admin can uninstall the app in Slack to revoke the Slack installation itself.

## Verification

```sh
pnpm lint
pnpm format:check
pnpm check-types
pnpm build
pnpm test
```

`pnpm test` runs unit tests and skips database tests unless `TEST_DATABASE_URL` is
set. To run the Postgres integration suite against a separate local test database:

```sh
docker compose exec postgres createdb -U company vows_test
DATABASE_URL=postgresql://company:company_local@localhost:5433/vows_test pnpm db:migrate
TEST_DATABASE_URL=postgresql://company:company_local@localhost:5433/vows_test pnpm test
```

The tests create and clean up isolated organization fixtures. Slack sends are
stubbed; live OAuth installation and delivery need a configured Slack app.
