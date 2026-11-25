# Shared family data — setup

This feature is developed on `feature/shared-family-data`. Until a Supabase project is connected, **the existing app continues to save locally**. No service-role keys should be placed in browser code.

## Architecture
- Supabase Auth: passwordless email link; no password management in the app.
- Postgres with Row Level Security: each household's plan, recipes, and membership records are isolated.
- The household owner can create an email-bound invitation that expires after 7 days.
- The invited user signs in with exactly that email and redeems the invitation code.
- Manual **Save current plan** and **Load shared plan** prevent unexpected synchronization while testing.
- Plans currently store the same selected recipes and pantry Have/Need state already used by the local prototype.
- Shopping and emails remain review-only; no cart modifications or automatic sends.

## Supabase configuration (project owner)
1. Create a Supabase project under your account.
2. In **SQL Editor**, review and execute `supabase/migrations/20261117_001_family_data.sql` (or apply the migration using your migration runner).
3. In **Authentication > URL Configuration**, configure your production Site URL to `https://family-meal-planner-blush.vercel.app`; add the Vercel preview hostname(s) as redirect URLs when testing preview.
4. In **Authentication > Providers > Email**, enable email-link sign-in and set your desired verification and rate-limit options.
5. In Vercel project environment variables, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the target environments. These are the **public** project URL and anon/publishable key, not the service-role key.
6. Redeploy after setting environment variables.
7. Create the initial family workspace using your email sign-in. Create an invitation for the second user's verified email. Sign into that email in the other browser/device and redeem its code.

## Smoke tests
- With no Supabase variables, the app builds and local meal planning still works.
- With Supabase configured, sign in using an email link. Create a family workspace, Save the menu, then refresh and Load it.
- Sign in as a second family member with their own account and accept an email-bound invitation. Load the same shared menu and Save an edit. Reload in the original account to verify the edit.
- Confirm a separate, unrelated signed-in user cannot query other households' rows.
- Confirm a wrong-email user cannot redeem an invitation and that unauthenticated users cannot use privileged RPCs.
- Check that an email link redirected back to the exact Vercel origin after signing in.

## Limitations and next work
- Manual Save / Load is intentional for MVP; simultaneous edits can overwrite each other. Add revision checks and real-time subscriptions before automatic sync.
- The pantry is currently a Have/Need flag keyed by ingredient name. Future releases should normalize units and track actual quantity before grocery cart automation.
- Optional per-household custom recipes are represented by `family_recipes`, but the recipe editor has not been built.
- Add an explicit household invitation management screen, invitation revocation, audit history, and account deletion for a production rollout.

## Project provisioned

Supabase project: `mxirdzjbmjumknctyjdp` (US West). The base schema has been applied and row-level security confirmed on all five family tables. Vercel preview-only public environment variables are configured. This branch needs a new preview build to ingest them. Set Authentication URL Configuration before email-link tests.

## Next iteration: automatic saving and recipe library
- Plan revisions are checked by the `save_family_plan` RPC. A stale save raises `VERSION_CONFLICT` instead of overwriting.
- Realtime listens for family plan updates; periodic polling handles missed notifications.
- Changes save automatically after approximately one second of inactivity.
- If another device edits while local changes remain unsaved, the user must select **Load their version** or explicitly **Keep my version** after confirmation.
- Old clients' manual updates are tracked through a backward-compatible revision trigger.
- The family recipe library supports storing curated meals, adding custom recipes, marking favorites, and placing saved recipes in any of the five meal slots.
- Recipes are stored in `family_recipes` and isolated by household RLS, with Realtime plus periodic refresh.
- The live production application remains unchanged until the feature branch has been tested end to end.

## Important preview sign-in configuration
The fixed test deployment hostname previously authorized in Supabase differs from new preview deployment hostnames. For reliable preview sign-in, add the **stable branch alias** below to Supabase Authentication > URL Configuration > Redirect URLs:

`https://family-meal-planner-git-feature-sha-80c361-liamphilipbrett-1194.vercel.app/**`

Use this stable branch alias for testing new commits. Avoid repeatedly adding ephemeral commit-specific hostnames.

## Menu recommendations (new)
- Signed-in household members can use **Weekly menu ideas** to rank curated recipes and the household recipe library.
- Recommendations consider recent approved menus (last 3 approvals), pantry Have flags, protein variety, dinner time limits, and comma-separated ingredient exclusions.
- Approving a weekly menu records a brief history inside the shared family plan, capped at 16 menu entries. Suggestions do not overwrite the current plan until the user explicitly selects **Use this suggested menu** and confirms.
- Suggestions are user-reviewed, not automatically purchased or emailed.

### Optional paid AI recipe generation
The app now has a server-side `POST /api/ai-menu` endpoint for generating complete new recipes. **This feature is OFF until a server-side API credential is deliberately added.** It requires `OPENAI_API_KEY` in Vercel (use an encrypted or sensitive *server-only* environment variable; never prefix with `NEXT_PUBLIC_`). Optionally configure `OPENAI_MEAL_MODEL`; default is `gpt-5-mini`. Do not commit keys to GitHub, expose them in screenshots, or paste them into public chat.
- Requests require a valid Supabase access token and household membership. The endpoint checks the family with the caller's identity before making a model request.
- A database-backed quota permits up to 3 AI menu generations per household member per UTC day. Quota reservation is atomic; the underlying usage table is not writable through the public API.
- The prompt requests five fully specified recipes, honoring ingredient exclusions and realistic weeknight preparation times. Returned JSON is validated before it may be previewed.
- A successful generation incurs OpenAI API charges based on the selected model and token usage. A Vercel project env var is not sufficient by itself if the OpenAI API account lacks billing/credits.
- The app deliberately does not make any model calls while `OPENAI_API_KEY` is unset. The no-cost smart recipe recommendations remain usable.
- Before enabling real paid generation, review billing limits and test with a single request from an authorized family account.

### Acceptance checks
- With no AI key, selecting AI mode displays a clear unavailable message without modifying the weekly plan.
- With a configured key, only household members may generate; a nonmember receives 403 and an unauthenticated request receives 401.
- The 4th AI generation on the same UTC day returns a limit error.
- The generated menu requires explicit confirmation; changing preferences alone does not replace menu choices.
- After approval, the previous approved menu appears in history and new weekly suggestions deprioritize repeats.
- Avoid-list constraints never silently fall back to disallowed recipes in the smart recommender.

## Gemini free-tier AI option (November 2026)
The `/api/ai-menu` route now prefers `GEMINI_API_KEY` when present. It uses Google's REST `generateContent` endpoint with `responseMimeType: application/json` and `responseJsonSchema` and defaults to `gemini-2.5-flash-lite`. Override with `GEMINI_MEAL_MODEL` if that model is not available to a newly created project. If no Gemini key is configured but `OPENAI_API_KEY` is present, the route falls back to OpenAI's `gpt-5-nano` (override with `OPENAI_MEAL_MODEL`). Without either key, it returns an explicit not-configured response and does not consume the quota.
The existing authentication, household membership, three-AI-menus-per-day limit, schema checks, ingredient exclusions, and explicit menu approval remain in place.

**Configuration:** Visit https://aistudio.google.com/apikey, create a Gemini API key in an eligible project, then set `GEMINI_API_KEY` in Vercel Project Settings > Environment Variables for **Preview only** as a sensitive server-side variable. Never use `NEXT_PUBLIC_` for API keys. Redeploy the preview to populate the new key. Free-tier capacity is rate-limited, eligible models and project availability can change, and Google may use free-tier content to improve services; do not send highly sensitive personal details in preferences. Verify the per-key quota and applicable privacy terms in AI Studio. The keys are NOT configured by this change.
Official pricing: https://ai.google.dev/gemini-api/docs/pricing and https://developers.openai.com/api/docs/models/gpt-5-nano

### Gemini activation verification
On 2026-11-24, the Vercel project's Preview environment showed a sensitive `GEMINI_API_KEY`. A fresh feature-branch deployment is required to apply the variable to the running server function. The key must remain server-only; don't paste its value into GitHub or client code.
