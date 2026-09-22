# Railway deployment

Vows runs as **Web**, **API**, **Worker**, and **Postgres**. API is a standalone
Hono HTTP server; Worker is a separate notification process. Next.js renders the
UI and proxies API/MCP traffic over the private network. It does not import or
execute backend routes. The docs app is not needed for a deployment.

The project definition is [`railway.ts`](railway.ts), using Railway's current
[Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) format.
Use Railway CLI 5.42.1 or newer. Older `railway.json` / `railway.toml` service
configs are deprecated and cannot configure new services.

## Deploy your own instance

1. Fork this repository if you want to maintain your own changes. Update the
   GitHub repository in `railway.ts` to your fork if applicable.
2. Install dependencies with `pnpm install --frozen-lockfile` and install the
   current Railway CLI with `npm install -g @railway/cli`.
3. Run `railway login`, then `railway init` to create a new, dedicated project.
4. Run `railway config plan`, review the four resources, then
   `railway config apply`. Keep all three app services rooted at the repository root.
5. In **Web → Variables** and **API → Variables**, enter the required values below. `preserve()` in the
   configuration keeps values managed in Railway out of source control.
6. In **Web → Settings → Networking**, generate a public domain targeting port
   **3000**. Keep API, Worker, and Postgres private. Set Web's `APP_URL` to
   `https://${{RAILWAY_PUBLIC_DOMAIN}}`, or your custom domain's HTTPS origin.
7. Deploy API, Web, and Worker after saving the variables. The Web build needs the
   Clerk publishable key, so rebuild if you change it later.
8. Follow the Clerk setup below, then visit the generated Web URL.

The first build can fail until you supply the Clerk keys. After configuration,
API runs database migrations before starting. A failed migration blocks that
deployment. Worker can start before the initial migration finishes; it retries
its polling loop every five seconds until the database is ready.

### Variables

| Service | Variable                                    | Value                                                                         |
| ------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Web     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`         | Your Clerk publishable key; required at build time and runtime                |
| Web     | `CLERK_SECRET_KEY`                          | Matching Clerk secret key for page authentication                             |
| Web     | `API_URL`                                   | `http://${{API.RAILWAY_PRIVATE_DOMAIN}}:3101`; used at build time and runtime |
| Web     | `APP_URL`                                   | `https://${{RAILWAY_PUBLIC_DOMAIN}}`                                          |
| API     | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Configured as references to Web's Clerk keys                                  |
| API     | `DATABASE_URL`                              | Configured automatically from Postgres                                        |
| API     | `APP_URL`                                   | Reference to Web's public origin                                              |
| API     | `INTEGRATION_ENCRYPTION_KEY`                | A stable base64-encoded 32-byte random key                                    |
| API     | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`    | Optional; supply both to enable Slack OAuth                                   |
| API     | `CLERK_OAUTH_ISSUER`                        | Optional; for Clerk OAuth access to MCP                                       |
| Worker  | `DATABASE_URL`                              | Configured automatically from Postgres                                        |
| Worker  | `APP_URL`, `INTEGRATION_ENCRYPTION_KEY`     | References to Web's origin and API's encryption key                           |

Generate the encryption key once:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep the key stable across deployments. Changing it requires reconnecting Slack.
For a custom domain, set Web's `APP_URL` to its HTTPS origin. The IaC uses
`preserve()` so future applies retain it.

### Clerk and Slack

Create a Clerk application and enable Organizations, membership optional, user
organization creation, and email verification. Retain the default `org:admin`
and `org:member` roles. Configure Clerk for the deployment's domain; for a Clerk
production instance, complete its custom-domain and DNS setup. Use matching
publishable and secret keys from the same instance.

For Slack, set the OAuth redirect URL to
`https://YOUR_HOST/api/manage/slack/callback` and follow the Slack setup in the
root README. Slack credentials are optional for customer tracking and portals.

### Runtime

- Node 24 and the repository's pinned pnpm version are used by Railpack.
- Web builds with `pnpm build:railway:web`; API builds with
  `pnpm build:railway:api`; Worker builds with `pnpm build:railway:worker`.
  Each builds its own workspace dependencies first.
- Development dependencies remain available so `pnpm db:migrate` can run
  `drizzle-kit` in the pre-deploy container.
- Web listens on port 3000. Its `/health` checks the web process only.
- API listens on IPv4 and IPv6 port 3101 (`::` supports Railway private
  networking). API `/health` returns 200 when Postgres is reachable, otherwise 503. Neither healthcheck redirects to Clerk.
- Web forwards `/api/*`, `/mcp`, and OAuth discovery to `API_URL`. Browser
  sessions and Slack callbacks keep the public web origin. Rebuild Web if
  `API_URL` changes. Database and Slack credentials stay off Web.
- Worker is an always-running process with no public HTTP endpoint. Railway
  allows 30 seconds for shutdown so an in-flight delivery can finish.
- Railway IaC is applied through the CLI; changes to `railway.ts` need another
  `railway config plan` / `railway config apply`. GitHub source pushes rebuild
  app code using the configured build and start commands.

## Maintainer: activate the one-click button

The README badge currently opens the deployment instructions. Replace its target
with the real template URL after this account-level setup; a repository config
alone does not create a Railway template.

1. Push these files to the source repository and verify a deployment using the
   instructions above, including Web/API health and a running Worker.
2. Open the project's settings and choose **Generate Template**, or run
   `railway templates create --json` with the current CLI.
3. In the template editor, retain all four services and Postgres's persistent
   volume. Enable public networking only for Web, on port 3000.
4. Replace Web's Clerk keys with **required user inputs**, with no saved values.
   Clear API's Slack credentials and `CLERK_OAUTH_ISSUER`, making them optional inputs.
   Never distribute the maintainer's credentials or deployment-specific URLs.
5. Set API's `INTEGRATION_ENCRYPTION_KEY` to this generated template value:

   ```text
   ${{secret(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")}}=
   ```

6. Keep API/Worker's database references, Web's generated `APP_URL` and private
   `API_URL`, API's Clerk key references, and Worker's encryption key reference.
   Confirm all three app services retain their separate build/start commands,
   API's pre-deploy migration and database healthcheck, and Web's healthcheck.
7. Save the template, copy its share URL, and replace the root README badge's
   `#deploy-on-railway` target with that URL. Test a fresh template deployment
   using a separate Clerk application before publishing it to the marketplace.

Railway documents the [template editor](https://docs.railway.com/templates/create)
and [deploy button](https://docs.railway.com/templates/publish-and-share).
