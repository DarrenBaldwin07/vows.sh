This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## UI components

The web app uses Tailwind CSS 4.3.3 and shadcn/ui's Radix Nova preset. Shared components, the `cn` helper, and neutral theme tokens live in `packages/ui`. The theme follows the system color preference and uses the app's local Geist fonts.

With Node 24+ and the repository's pnpm version, add components from the repository root:

```bash
pnpm dlx shadcn@latest add dialog -c apps/web
```

The CLI places shared primitives in `packages/ui/src/components` and app-specific compositions in `apps/web/components`. Import shared components with:

```tsx
import { Button } from '@repo/ui/components/button';
```

Existing starter imports such as `@repo/ui/button` remain available.

## Authentication

Clerk provides sign-in at `/sign-in`, sign-up at `/sign-up`, and account controls in the header. Its provider uses the shared shadcn theme. `proxy.ts` enables Clerk sessions; routes remain public until explicitly protected with `await auth.protect()` from `@clerk/nextjs/server`.

The Clerk CLI writes local development keys and auth route settings to the ignored `apps/web/.env.local`. From this directory, run `npx -y clerk@latest init` to provision development keys for a fresh checkout, and `npx -y clerk@latest doctor` to check setup. Use Node 24+ and pnpm 11.25.0 for this repository.

Start the web app from the repository root with `pnpm --filter web dev`, then visit http://localhost:3000 and sign up to create a test user. To claim the development application, run `npx -y clerk@latest auth login` from `apps/web`. Before production, claim the app and run `npx -y clerk@latest deploy` to configure production keys. Never commit `.env.local` or expose `CLERK_SECRET_KEY` to client code.
