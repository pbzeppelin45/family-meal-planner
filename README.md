# Family Meal Planner — hosted prototype v1

A Next.js + React + TypeScript progressive-friendly web prototype built from the prior single-file HTML project.

## What works

- Five meal categories; swap or skip recipes
- Ingredient inventory with Have / Need controls
- Consolidated shopping-list view
- Complete recipe packet and downloadable TXT copy
- Pre-addressed **email draft**, not automatic delivery
- Browser-local saved selections (only on the same device/browser)

## Not connected yet

- No login, cloud database, or shared cross-device state
- No real Safeway cart write or pickup integration
- No AI recipe generation
- No automatic email send

## Run locally

1. Install Node.js 20.9+ (Node.js 22 LTS recommended).
2. `npm install`
3. `npm run dev`
4. Open http://localhost:3000

## Deploy to Vercel (easiest)

1. Create a **private** GitHub repository called `family-meal-planner`.
2. Upload/push the files from this folder (not the enclosing zip folder).
3. Log in to Vercel and select **Add New > Project > Import Git Repository**.
4. Choose the repository. Vercel should detect Next.js automatically.
5. Choose **Deploy**. Vercel supplies a live `*.vercel.app` URL.
6. Optionally add a custom domain under **Project > Settings > Domains**.

No environment variables are required for v1. Subsequent releases will require database and AI API credentials, kept on the server.

## Safety / deployment notes

- Treat this as a prototype; anyone with the public URL can access its built-in recipe examples.
- Browser-local state is not synchronized between devices.
- Use server-side authorization and per-family database isolation before connecting accounts or storing personal data.
- Never put Safeway/Google/OpenAI credentials in client-side `NEXT_PUBLIC_` variables.
- The email button uses `mailto:`; there is no background email delivery.
