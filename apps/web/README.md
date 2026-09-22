# Vows web

Next.js App Router with Clerk, TanStack Query, and the shared UI package.
See the root README for setup, Clerk organization configuration, Slack, and tests.

- `/customers`: searchable active customer list.
- `/customers/[id]`: requests grouped by status, request editor, and sharing.
- `/integrations`: Slack connection and workspace notification preference.
- `/settings`: custom workspace settings and team management backed by Clerk hooks.
- `/share/[token]`: private, read-only customer portal.
- `/api/*`: Hono API with server-verified Clerk identity.

Press **Cmd+K** (or **Ctrl+K**) anywhere in the dashboard, or use Search in the
sidebar. The command menu searches customers (including archived customers),
request titles and details, and app navigation within the active workspace.
Choose a customer to search only their requests, filter by status, or open their
page. Selecting a request opens its editor using `?request=<id>` on the customer
page. Results are capped at 20 customers and 30 requests; narrow the search when
more matches are available. Escape closes the menu; Backspace in an empty scoped
search returns to workspace search.

Workspace admins can upload, replace, or remove a logo in Settings. Logo files
are stored by Clerk using `organization.setLogo`, and displayed in the custom
workspace switcher. Supported uploads are PNG, JPG, WebP, and GIF up to 10 MB;
workspaces without a logo use their colored initial badge.

Clerk keys belong in the ignored `.env.local`; `.env.example` lists the names.
All manager and share pages require authentication. Manager API calls also check
organization membership; share API calls independently authorize a verified email.
Clerk's organization membership requirement must be **optional** globally so
customer viewers can sign in without creating an internal workspace.

TanStack Query caches are scoped to organization IDs and reset when the signed-in
user changes. Customer portal queries include the account ID and refetch every
30 seconds. Private API responses use `Cache-Control: private, no-store`.

Run root `pnpm dev`, or build dependencies first with
`pnpm exec turbo run build --filter=@repo/api` before `pnpm --filter web dev`.
`apps/web/AGENTS.md` contains the installed Next.js documentation instructions.
