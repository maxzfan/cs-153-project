---
date: 2026-05-03
topic: supabase-email-confirmation-landing
---

# Supabase Email Confirmation Landing Page

## Problem Frame

0studio is an Electron desktop app. On signup, `AuthContext.tsx:134` passes `emailRedirectTo: ${window.location.origin}` to `supabase.auth.signUp`. In dev that resolves to `http://localhost:5173`, in production builds to a `file://` URL — neither is reachable from the user's email client. The Supabase confirmation succeeds server-side, but clicking the link in the email lands the user on a broken localhost page, making the flow look broken even though the account is confirmed.

We need a real, hosted landing page for Supabase to redirect to after email confirmation.

## Requirements

- R1. A `GET /auth/confirmed` route on the existing Railway-hosted Express backend (`https://backend-production-7dcce.up.railway.app`) returns a self-contained HTML page that loads without JS, network, or auth.
- R2. The page communicates: account confirmed, the user should return to the 0studio desktop app and sign in. Soft, friendly tone — no buttons that pretend to launch the app.
- R3. The page includes light branding: 0studio wordmark/logo, one short headline, one short instruction line. Visually consistent enough with the app that it doesn't feel like a third-party error page.
- R4. `AuthContext.tsx` `signUp` uses the hosted URL (sourced from `VITE_BACKEND_URL` + `/auth/confirmed`) as `emailRedirectTo`, instead of `window.location.origin`.
- R5. Supabase project settings updated: Site URL and Additional Redirect URLs include the new hosted URL so the redirect is allowed in both dev and prod builds.

## Success Criteria

- Signing up with a new email and clicking the confirmation link lands on the hosted page (not localhost), in both `npm run electron:dev` and packaged production builds.
- Page renders correctly when opened cold from a phone email client (no app installed on that device) — i.e. it's a real web page, not something that requires 0studio to be present.
- Account is confirmed in Supabase after the click (verified via dashboard or by signing in inside the app).
- No regressions to Google OAuth login or password reset flows.

## Scope Boundaries

- **Out of scope:** Google OAuth callback (`AuthContext.tsx:183`) and password reset (`AuthContext.tsx:221`). They share the same `window.location.origin` bug but need different UX (OAuth must return a session, reset needs a form). Tracked as a follow-up.
- **Out of scope:** Custom protocol handlers / deep linking back into the Electron app (`0studio://...`). Deferred unless this lands and the "go back to the app manually" step proves to be a real friction point.
- **Out of scope:** Magic-link / OTP signup flow. Larger auth redesign, not warranted by this bug.
- **Out of scope:** Server-side analytics or tracking on the landing page.

## Key Decisions

- **Host the landing page on the existing Railway backend, not a new service.** Rationale: zero new infra, the backend is already deployed and trusted, and a single static route has effectively zero carrying cost. Avoids spinning up Vercel/Netlify for one page.
- **Static HTML, inlined CSS, no framework.** Rationale: page must work without JS in any email client's browser. Keeps the route additive and isolated from the rest of the backend.
- **Read base URL from `VITE_BACKEND_URL`.** Rationale: the env var already exists in `.env.production` and is already used elsewhere; avoids a new config knob.
- **Include light branding rather than a bare "Confirmed."** Rationale: this is the first post-signup impression. Cheap to do now (one logo + two lines of copy), awkward to retrofit later. Carrying cost is trivial — one HTML file.
- **No "Open 0studio" button, just an instruction.** Rationale: there's no reliable way to launch the desktop app from a browser without a custom protocol handler, which is explicitly out of scope. A button that doesn't work is worse than a clear instruction.

## Dependencies / Assumptions

- Assumes the Railway backend deployment is the right place to add a public, unauthenticated route. (It already serves Stripe webhooks, so unauthenticated public routes are an existing pattern.)
- Assumes Supabase project settings can be updated by whoever runs this implementation (dashboard access).
- Assumes a 0studio logo asset exists or can be sourced; otherwise wordmark-only is acceptable for R3.

## Outstanding Questions

### Resolve Before Planning

- (none)

### Deferred to Planning

- [Affects R3][Technical] Where does the logo asset live, and is it small enough to inline as base64 / SVG, or should it be served as a static file from the backend?
- [Affects R5][User decision] Exact final copy for the headline and instruction line — pick during implementation, easy to iterate.
- [Affects R1][Technical] Should the route also handle the `?error=...` query params Supabase appends on a failed/expired confirmation, or render the same success page either way? Decide during implementation by checking what Supabase actually appends.

## Next Steps

→ `/ce:plan` for structured implementation planning
