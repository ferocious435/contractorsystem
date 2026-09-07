This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Runtime Verification

Use the local guards before treating pricing changes as ready:

```bash
npm run verify:boq-scale
npm run verify:financials
npx tsc --noEmit
npm run build
```

For the authenticated Pricing UI check, first run the app locally on port 3000, then provide session evidence through environment variables. Do not commit real cookies or passwords.

Option A, login-based verification:

```powershell
$env:VERIFY_RUNTIME_LOGIN_EMAIL="<contractor email>"
$env:VERIFY_RUNTIME_LOGIN_PASSWORD="<contractor password>"
npm run verify:runtime-pricing
```

With login-based verification, the script discovers one project owned by the logged-in contractor. To force a specific project, also set:

```powershell
$env:VERIFY_RUNTIME_PRICING_PROJECT_ID="<project id>"
```

Option B, cookie-based verification:

```powershell
$env:VERIFY_RUNTIME_COOKIE_FILE=".runtime-cookie-local"
$env:VERIFY_RUNTIME_PRICING_PROJECT_ID="<project id>"
npm run verify:runtime-pricing
```

Files matching `.runtime-cookie*` are ignored by Git. The strict pricing check fails closed when no session evidence is provided.

## Local document comparison AI

The contradiction radar can run through local Ollama without a cloud AI key. Installation, configuration, and the read-only `C-CE6070` check are documented in [docs/LOCAL_AI_SETUP_RU.md](docs/LOCAL_AI_SETUP_RU.md).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
