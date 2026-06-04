---
title: Hosted email confirmation landing page
type: feat
status: active
date: 2026-05-03
origin: docs/brainstorms/2026-05-03-supabase-email-confirmation-landing-requirements.md
---

# Hosted email confirmation landing page

## Enhancement Summary

**Deepened on:** 2026-05-03
**Reviews applied:** security-sentinel, code-simplicity-reviewer, julik-frontend-races-reviewer

### Key simplifications (from review)

1. **Two render states, not three.** Default HTML *is* the success copy ("Email confirmed. Open 0studio and sign in."). JS only swaps to an error variant when the fragment contains `error_code`. The "indeterminate" third state is a phantom — the success copy is correct in that case too. Drops the entire state-machine pattern.
2. **No `sessionStorage`.** Cutting the three-state machine removes the only reason for it. Also removes a real bug: if `setItem` threw in Safari private mode after success was rendered, the JWT would be stuck in the address bar.
3. **No `<noscript>` block.** The default rendered HTML serves users without JS already.
4. **No factory wrapper.** Single static route inlined in `backend/server.js`. The `routes/*.js` factory pattern is for routes with injected dependencies; this has none.
5. **No new doc file.** Append a short subsection to `docs/GOOGLE_AUTH_SETUP.md`, which already covers redirect-URL conventions for this project.
6. **No light-only / dark-mode `@media`** — light only for v1. Page is on screen ~5 seconds before the user switches back to the app.
7. **Tighter error fragment match** — `error=` or `error_code=` after `#` or `&`, not bare `error`. Avoids matching incidental substrings on crafted URLs.
8. **Drop preemptive access-log redaction AC.** Backend has no request logger today. Re-add the rule when one is introduced.

Net change: ~55% LOC reduction in the page. Plan reflects the simplified design throughout.

## Overview

Add a single static HTML route — `GET /auth/confirmed` — to the existing Railway-hosted Express backend, then update Supabase signup so the email confirmation link redirects there instead of `window.location.origin` (which resolves to `file://` in production Electron builds and `http://localhost:5173` in dev — neither reachable from a user's email client).

The page renders three states based on the URL fragment Supabase appends: success, error (e.g. expired link), or indeterminate (no fragment / JS disabled). It scrubs the access token from the URL on load, enforces a strict CSP, and works without the desktop app installed on the device (e.g. when the user opens the email on a phone).

## Problem Statement / Motivation

`src/contexts/AuthContext.tsx:134` currently passes:

```ts
emailRedirectTo: `${window.location.origin}`,
```

In production Electron, `window.location.origin` is a `file://` URL pointing at the user's local app bundle. In dev it's `http://localhost:5173`. Neither URL exists from the perspective of the user's email client:

- Email is opened on a phone → `localhost:5173` is the phone's loopback, not the user's laptop.
- Email is opened on the same machine but the dev server is off → `ERR_CONNECTION_REFUSED`.
- Production build → `file://` does nothing.

The Supabase server-side token verification still succeeds (`auth.users.email_confirmed_at` is set during the redirect), so the account is technically confirmed — but the user sees a broken page and reasonably concludes signup failed. The fix is a real hosted page on a stable URL.

## Proposed Solution

1. **New backend route** — `GET /auth/confirmed` inlined in `backend/server.js`, returning self-contained HTML with inline CSS, inline JS, and no external network calls.
2. **Default-state-is-success.** The HTML body renders the success copy by default ("Email confirmed. Open 0studio and sign in."). This is correct in 95% of cases (the link worked) and harmless in the rest (the user can try the app and see what happens). It also serves as the no-JS fallback automatically.
3. **JS overrides to error variant only when needed.** A small inline script (~12 lines) reads `window.location.hash`, immediately calls `history.replaceState(null, '', location.pathname)` to scrub the JWT, and — only if the fragment matched `error=` or `error_code=` — replaces the title and body text with the expired-link copy that mentions email scanners.
4. **CSP header** — `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'` — locks down third-party exfiltration of the JWT in the fragment.
5. **AuthContext update** — `src/contexts/AuthContext.tsx:134` reads the URL from `import.meta.env.VITE_BACKEND_URL` (matching the existing pattern at `AuthContext.tsx:38`), appends `/auth/confirmed`.
6. **Supabase dashboard config** — add the hosted URL (prod + both dev URLs) to Additional Redirect URLs and set Site URL to the prod URL. No trailing slashes per `docs/GOOGLE_AUTH_SETUP.md`.

## Technical Considerations

- **Architecture impacts.** Single inline `app.get('/auth/confirmed', ...)` handler in `backend/server.js`. Not factored into `backend/routes/auth.js` because there's no injected dependency to factory-wrap and only one route. If Google OAuth and password reset land here later (the deferred follow-ups), refactor into a factory then. Mounted at `/auth` (not `/api/auth`) — `/health` is the only existing non-`/api` route, but a public-by-design human-facing page belongs at a clean URL, not nested under `/api/*` which is the JSON API surface.

- **Performance.** Page is < 10 KB, no external requests, no fonts to load, no images. Cold render is essentially TTFB. Express access log explicitly redacts `/auth/confirmed*` query strings (Supabase puts tokens in fragments, not queries, but this insulates against future flow changes).

- **Security.** The fragment Supabase 302s to contains a usable JWT. Any third-party script (font CDN, analytics, browser extension reading `document.location`) could exfiltrate it. Mitigations: zero third-party scripts (CSP enforces), `history.replaceState` strips fragment from address bar / history / future referers.

- **Font.** Use a system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif`) rather than self-hosting Inter. The backend has no static-asset pipeline today and adding 352 KB of font data for a single page is disproportionate. The visual difference between Inter and the SF/Segoe system fallbacks is small for a page with two lines of copy.

- **Branding constraint.** No SVG wordmark exists in the repo. The brand presents everywhere as plain text "0studio" rendered in the warm-neutral palette (`hsl(30 3% 10%)` foreground on `hsl(30 3% 97%)` background). The landing page mirrors that — text wordmark, same palette, same `text-3xl font-semibold tracking-tight` weight as `WelcomePanel.tsx:214`.

- **Email scanner prefetch.** Microsoft Defender / Proofpoint / Mimecast prefetch links in incoming mail and consume the single-use token before the user clicks. Real users on those providers see `otp_expired`. The error copy explicitly mentions this so users on corporate email aren't confused.

- **Mobile users.** "Open 0studio and sign in" is meaningless on iOS / Android — 0studio is desktop-only. Copy explicitly says "0studio is a desktop app for macOS — open it on your computer to finish signing in" for mobile clients (or actually: render this same line on every device since we can't reliably detect, and it's harmless on desktop).

- **The implicit-vs-PKCE flow question.** Default Supabase email templates use the implicit `/auth/v1/verify` flow. Tokens land in the URL fragment, account is verified server-side before redirect, no client-side `verifyOtp` call needed. We don't need to switch to PKCE for this feature; doing so would require editing the email template and adding a server-side `verifyOtp` call. Out of scope.

## System-Wide Impact

- **Interaction graph.** `signUp` in `AuthContext.tsx:128` → `supabase.auth.signUp({ ..., options: { emailRedirectTo: <url> } })` → Supabase server queues email (Postmark/SendGrid via Supabase) → user clicks → browser → Supabase `/auth/v1/verify` → DB update on `auth.users` → 302 to our route → Express → static HTML → user. No new server-side state, no callbacks, no triggers — the only DB write is Supabase's existing `email_confirmed_at` update.

- **Error propagation.** Express route can't fail meaningfully — it returns a static string. Any 5xx is infra-level (Railway down). On the client side, fragment-parse errors degrade gracefully to indeterminate state. No retry logic needed.

- **State lifecycle.** No persistent state anywhere — no backend writes, no `sessionStorage`, no cookies. Refresh of the page after a successful confirmation re-runs the same JS against an empty fragment (the original was scrubbed by `replaceState`), which leaves the default success copy showing. Correct outcome with no state.

- **API surface parity.** The Google OAuth callback (`AuthContext.tsx:183`) and password reset (`AuthContext.tsx:221`) share the same `window.location.origin` bug. **Explicitly out of scope** for this plan (origin doc deferred them) — they require different UX (OAuth needs to actually return a session, reset needs a password form). Tracked as separate follow-up plans.

- **Integration test scenarios** — manually verify by constructing fragment shapes locally, no Supabase round-trip needed:
  1. `http://localhost:3000/auth/confirmed` (no fragment) and `…#access_token=test&type=signup` (success) → both render the default success copy. Address bar shows clean URL after load (JWT scrubbed).
  2. `http://localhost:3000/auth/confirmed#error=access_denied&error_code=otp_expired&error_description=...` → error copy mentions email scanners.
  3. End-to-end: actual signup with a real email → click link → land on page in correct state → return to app → sign in works.

## Acceptance Criteria

### Functional

- [ ] `GET /auth/confirmed` on the Express backend returns 200 with `Content-Type: text/html; charset=utf-8` and a self-contained HTML page.
- [ ] Default rendered HTML (no JS, no fragment) shows the success copy: "Email confirmed. Open 0studio on your computer and sign in. 0studio is a desktop app for macOS." This serves users without JS automatically — no `<noscript>` block needed.
- [ ] When the URL hash matches `error=` or `error_code=`, JS replaces the title and body text with the expired-link copy that mentions email scanners.
- [ ] If the URL has any fragment, JS calls `history.replaceState(null, '', location.pathname)` immediately on load (before any DOM mutation), so a JWT in the fragment is not in the address bar, browser history, or any subsequent `Referer` header.
- [ ] On expired-link, copy explicitly says: "Your email link may have already been opened (some corporate email systems automatically click links to scan them) — open 0studio and request a new confirmation."
- [ ] `src/contexts/AuthContext.tsx:134` updated: `emailRedirectTo` reads `${BACKEND_URL}/auth/confirmed` using the existing `BACKEND_URL` const at line 38.
- [ ] Supabase Site URL set to `https://backend-production-7dcce.up.railway.app/auth/confirmed`.
- [ ] Supabase Additional Redirect URLs include all three: `https://backend-production-7dcce.up.railway.app/auth/confirmed`, `https://6zvgayn7mg.us-east-2.awsapprunner.com/auth/confirmed`, `http://localhost:3000/auth/confirmed`. No trailing slashes.

### Non-Functional

- [ ] Page total weight (HTML + inline CSS + inline JS) under 5 KB.
- [ ] Zero external network requests (no fonts, no images, no analytics, no fetch calls). Verify by loading with DevTools Network panel.
- [ ] CSP header set: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`.
- [ ] `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` headers also set.
- [ ] Renders correctly on iOS Safari, Android Chrome, desktop Chrome / Firefox / Safari.
- [ ] Page works without cookies, storage, referrer, or any prior session.
- [ ] No regressions to Google OAuth login or password reset flows (which still use `window.location.origin` and remain broken — documented out-of-scope, follow-up plan).

### Quality Gates

- [ ] Manually tested all 3 integration scenarios listed in System-Wide Impact.
- [ ] End-to-end test: real signup with disposable email, click link, land on page, return to app, sign in succeeds.
- [ ] Tested in dev with `VITE_BACKEND_URL=http://localhost:3000` — local backend serves the page, dev signup completes successfully.
- [ ] Confirmed in DevTools that after clicking a real Supabase link, the address bar URL is clean (no fragment) within ~50 ms of page load.

## Success Metrics

- **Primary:** Zero "broken localhost" reports from new signups.
- **Indirect:** Signup → first-session conversion rate doesn't drop after deploy (would indicate the page itself is confusing). No telemetry on the page in v1, so this is measured via the existing post-signup auth funnel in Supabase.

## Dependencies & Risks

- **Dependency:** Railway backend stays at `backend-production-7dcce.up.railway.app`. If it moves to a custom domain (e.g. `auth.0studio.xyz`), email links from past signups go dead and the desktop app needs a coordinated rebuild + Supabase reconfig. **Mitigation:** accept the migration cost when/if it happens; note this in `CLAUDE.md` next to backend URL discussion. Not worth setting up a custom domain pre-emptively for one page.
- **Risk:** Supabase Site URL / Additional Redirect URLs are dashboard-only configuration — not in code, not in CI, can drift silently. **Mitigation:** the README or `docs/GOOGLE_AUTH_SETUP.md` already documents redirect URL conventions; add a short subsection there listing the three required entries.
- **Risk:** A Supabase project upgrade silently switches to PKCE flow (changes the email template). Tokens then come as `?token_hash=...` in query string, our page renders the default success copy without verifying anything. **Mitigation:** the default success copy ("Email confirmed. Open 0studio and sign in.") is roughly correct in that case too — the user opens the app, attempts to sign in, and either succeeds (Supabase auto-verified server-side) or sees a clear "please confirm your email" message in the app. PKCE migration would be a separate follow-up to add `verifyOtp` server-side.

## MVP

### `backend/server.js` — inline route + HTML constant

Add this constant near the top of the file (after imports, before `const app = express()`):

```js
const EMAIL_CONFIRMED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Email confirmed — 0studio</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      background: hsl(30 3% 97%); color: hsl(30 3% 10%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: grid; place-items: center; padding: 2rem;
    }
    main { max-width: 28rem; text-align: center; }
    .brand { font-size: 0.875rem; color: hsl(30 3% 40%); letter-spacing: 0.02em; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.5rem; }
    p { color: hsl(30 3% 40%); margin: 0; line-height: 1.5; font-size: 0.95rem; }
    p + p { margin-top: 0.75rem; }
  </style>
</head>
<body>
  <main>
    <div class="brand">0studio</div>
    <h1 id="title">Email confirmed</h1>
    <p id="body">Open 0studio on your computer and sign in to get started.</p>
    <p>0studio is a desktop app for macOS.</p>
  </main>
  <script>
    (function () {
      var hash = window.location.hash || '';
      // Scrub any fragment first — Supabase puts a JWT in the success fragment.
      if (hash) history.replaceState(null, '', window.location.pathname);
      // Tighten the match: only swap to error copy when Supabase actually emitted an error.
      if (/[#&]error(=|_code=)/.test(hash)) {
        var t = document.getElementById('title');
        var b = document.getElementById('body');
        if (t) t.textContent = 'This link expired';
        if (b) b.textContent = 'Your email link may have already been opened — some corporate email systems automatically click links to scan them. Open 0studio and request a new confirmation.';
      }
    })();
  </script>
</body>
</html>`;
```

Add this route, mounted alongside `/health` (around line 98–100, before the `/api/*` mounts):

```js
app.get('/auth/confirmed', (_req, res) => {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.status(200).send(EMAIL_CONFIRMED_HTML);
});
```

No new file, no factory wrapper, no imports.

### `src/contexts/AuthContext.tsx` (the actual fix)

Around line 134, change:

```ts
// BEFORE
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${window.location.origin}`,
  },
});

// AFTER
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${BACKEND_URL}/auth/confirmed`,
  },
});
```

`BACKEND_URL` is already defined at `AuthContext.tsx:38`:

```ts
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
```

No new imports, no new env vars, no schema changes.

### Supabase Dashboard (manual config — do this in lockstep with deploy)

1. **Authentication → URL Configuration → Site URL:**
   `https://backend-production-7dcce.up.railway.app/auth/confirmed`

2. **Authentication → URL Configuration → Additional Redirect URLs:** add all three (no trailing slashes):
   - `https://backend-production-7dcce.up.railway.app/auth/confirmed`
   - `https://6zvgayn7mg.us-east-2.awsapprunner.com/auth/confirmed`
   - `http://localhost:3000/auth/confirmed`

## Implementation Order

1. Add the `EMAIL_CONFIRMED_HTML` constant and the `app.get('/auth/confirmed', ...)` handler to `backend/server.js`.
2. Test locally: `cd backend && npm run dev`, then visit `http://localhost:3000/auth/confirmed` (default success copy renders) and `http://localhost:3000/auth/confirmed#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` (copy swaps to expired). Confirm address bar URL is clean after JS runs.
3. Update Supabase dashboard: Site URL + Additional Redirect URLs.
4. Update `src/contexts/AuthContext.tsx:134` to use `${BACKEND_URL}/auth/confirmed`.
5. End-to-end test in dev with a real Supabase signup → real email → real click.
6. Deploy backend to Railway (existing deploy pipeline).
7. Repeat end-to-end test against production.
8. Append a short subsection to `docs/GOOGLE_AUTH_SETUP.md` documenting the three Additional Redirect URL entries and the Site URL — that file already covers the "no trailing slashes" convention; this is an additive note, not a new doc.

## Sources & References

### Origin

- **[docs/brainstorms/2026-05-03-supabase-email-confirmation-landing-requirements.md](../brainstorms/2026-05-03-supabase-email-confirmation-landing-requirements.md)** — origin requirements doc. Key decisions carried forward:
  - Host on existing Railway backend, not a new service (zero new infra).
  - Static HTML, inline CSS, no framework — must work without JS in any email client browser.
  - Read base URL from existing `VITE_BACKEND_URL` env var.
  - Light branding included; no "Open 0studio" button (no protocol handler exists).
  - Out of scope: Google OAuth callback, password reset, custom protocol deep links, magic-link flow, telemetry.

### Internal references

- `src/contexts/AuthContext.tsx:38` — canonical `VITE_BACKEND_URL` accessor pattern.
- `src/contexts/AuthContext.tsx:134` — the `emailRedirectTo` line being replaced.
- `src/contexts/AuthContext.tsx:183, 221` — same bug, deferred (Google OAuth + password reset).
- `backend/server.js:67-106` — middleware order, route mounting pattern, `/health` precedent for non-`/api` routes.
- `backend/routes/stripe.js:96` — existing public unauthenticated route precedent.
- `src/components/WelcomePanel.tsx:214` — in-app wordmark style reference (`text-3xl font-semibold tracking-tight`).
- `src/index.css:13-117` — color tokens (warm-neutral palette, HSL hue 30, 3% saturation).
- `docs/GOOGLE_AUTH_SETUP.md` — existing redirect-URL conventions ("no trailing slashes").

### External references

- Supabase auth — [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): Site URL is fallback, Additional Redirect URLs is the allowlist.
- Supabase auth — [verify endpoint](https://supabase.com/docs/reference/auth#verify-a-user): server-side token validation, 302 with fragment.
- Supabase auth — [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow): explicitly NOT used here; default email template stays on implicit flow.
- Supabase troubleshooting — [otp_expired errors](https://supabase.com/docs/guides/auth/troubleshooting): scanner prefetch consuming single-use tokens.

### Related work

- `docs/brainstorms/2026-05-03-supabase-email-confirmation-landing-requirements.md` (origin)
- Future follow-up plan needed for: Google OAuth callback page (different UX — must return a session) and password reset page (needs a password form).
