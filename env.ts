/**
 * env.ts — single source of truth for required `VITE_*` build-time env vars.
 *
 * Used by `@julr/vite-plugin-validate-env` (configured in vite.config.ts).
 * Build fails loud if any listed var is missing or malformed at build time
 * — both locally and in CI.
 *
 * The plan's Phase 0 confirmed (via gh run view 24014082411 --log-failed)
 * that the previous CI builds were silently embedding empty strings for
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_BACKEND_URL /
 * VITE_STRIPE_PUBLISHABLE_KEY because those secrets aren't configured in
 * GitHub Actions. After this PR lands, missing-secret builds will fail
 * with a readable error instead of producing an outwardly-functional app
 * that silently fails on every backend call.
 *
 * Schema additions: anything new in `src/` that uses
 * `import.meta.env.VITE_FOO` MUST be added here, otherwise the build
 * fails with "VITE_FOO is not declared in env.ts schema".
 */

import { defineConfig, Schema } from '@julr/vite-plugin-validate-env';

export default defineConfig({
  validator: 'builtin',
  schema: {
    // --- Required (every CI build needs these) -----------------------------
    VITE_SUPABASE_URL: Schema.string({ format: 'url' }),
    VITE_SUPABASE_ANON_KEY: Schema.string({ minLength: 20 }),
    VITE_BACKEND_URL: Schema.string({ format: 'url', tld: false }),
    VITE_STRIPE_PUBLISHABLE_KEY: Schema.string({ minLength: 20 }), // pk_test_* / pk_live_*

    // --- Optional / feature flags -----------------------------------------
    // Feature flags are stored as the string 'true' / 'false' (strings, not
    // booleans, because Vite's import.meta.env stringifies everything).
    // Consumers compare with === 'true', so anything else is treated as off.
    VITE_FEATURES_TEAM: Schema.string.optional(),
    VITE_FEATURES_PAYMENTS: Schema.string.optional(),
    VITE_AWS_API_URL: Schema.string.optional({ format: 'url' }),

    // --- Required-but-not-yet-configured ---------------------------------
    // These are referenced by src/pages/Dashboard.tsx and the runtime guard
    // in env-validation.ts requires them, but they're left optional in the
    // BUILD schema until real price IDs are added to .env.production. The
    // runtime guard will surface a fatal-error screen if they're missing
    // at app launch — so the user-visible failure mode stays "loud" while
    // local dev builds aren't blocked.
    // TODO(phase-1): once real values are configured, promote these to
    //   Schema.string({ minLength: 5 }) (price_*) above and remove this block.
    VITE_STRIPE_PRO_PRICE_ID: Schema.string.optional({ minLength: 5 }),
    VITE_STRIPE_ENTERPRISE_PRICE_ID: Schema.string.optional({ minLength: 5 }),
  },
});
