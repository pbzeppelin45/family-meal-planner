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
