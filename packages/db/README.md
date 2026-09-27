# @repo/db

Server-only Postgres/Drizzle package. `getDb()` lazily creates a shared pool;
`closeDb()` releases it. Configuration loads from the root `.env`, with explicit
environment variables taking priority.

Singular SQL tables: `Organization`, `Customer`, `CustomerAccess`,
`CustomerShareLink`, `Request`, `RequestEvent`, `Integration`,
`RequestSlackThread`, and `NotificationDelivery`.

A local Organization maps one-to-one to a Clerk Organization. Clerk owns team
membership and names. Composite foreign keys ensure requests belong to customers
in the same organization and Slack destinations use that organization's
integration. A partial unique index permits one active share link per customer.

Share tokens are random portal locators, not bearer credentials: every read also
requires Clerk authentication and verified email authorization. Locators are
stored so admins can copy the existing URL. Slack bot credentials use AES-256-GCM
encryption in the API; no credential columns are returned to browser clients.

`CustomerAccess.kind` distinguishes individual `email` invitations from shared
`domain` and `regex` rules; `email` stores the address, normalized domain, or
pattern respectively. Existing invitations default to `email`. Shared rules
authorize verified emails on every portal read and submission and never bind to
a single Clerk user. Domain rules match the exact domain (no subdomains); regex
rules use case-insensitive, full-email RE2 matching. Revoking a rule removes the
access it grants; another matching active invitation or rule can still allow access.

Generate migrations with `pnpm db:generate`, review the SQL, then apply with
`pnpm db:migrate`. The initial greeting migration remains as history; later
migrations replace it with the product schema. `pnpm db:seed` intentionally creates
no shared product data. Create a workspace and customers through the app.

Build this package before directly running API scripts: `pnpm --filter @repo/db build`.
Root `pnpm dev` and `pnpm build` handle dependency build order automatically.
