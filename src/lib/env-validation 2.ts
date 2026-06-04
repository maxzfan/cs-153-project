/**
 * env-validation.ts — runtime sanity check for VITE_* env vars.
 *
 * The build-time `@julr/vite-plugin-validate-env` plugin (env.ts) is the
 * primary defense and catches missing/empty values during `vite build`.
 * This runtime guard is belt-and-braces for one specific edge case the
 * plugin can miss: a CI run where a referenced secret RESOLVES to an
 * empty string at build time (e.g., `${{ secrets.UNDEFINED_SECRET }}`
 * stringified by GitHub Actions). Vite inlines that as `""`, so deep
 * call sites silently fail with empty Supabase URL / Stripe key / etc.
 *
 * On detection: render a fatal-error screen instead of mounting <App />.
 * Once Phase 5 (electron-log) ships, this should also push to the
 * diagnostic log via window.electronAPI.
 */

// Vars the app cannot render without. Stripe vars are checkout-time concerns
// and surface their own errors when the Upgrade flow runs — keep them out of
// the startup gate so an unconfigured Stripe doesn't blank the whole app.
const REQUIRED_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_BACKEND_URL',
] as const;

export function findMissingEnv(): string[] {
  return REQUIRED_VARS.filter(k => {
    const v = (import.meta.env as Record<string, unknown>)[k];
    return typeof v !== 'string' || v.trim().length === 0;
  });
}

export function renderStartupError(missing: string[], rootEl: HTMLElement): void {
  rootEl.innerHTML = `
    <div style="font-family: system-ui, -apple-system, sans-serif; padding: 48px; max-width: 640px; margin: 0 auto; color: #1f2937;">
      <h1 style="font-size: 22px; margin: 0 0 16px;">0studio failed to start</h1>
      <p style="margin: 0 0 16px;">Required configuration values were missing or empty in this build:</p>
      <ul style="margin: 0 0 24px 24px;">
        ${missing.map(v => `<li><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${v}</code></li>`).join('')}
      </ul>
      <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px;">
        This is a build-time configuration problem, not a runtime failure. The CI pipeline
        produced a bundle with empty values for the variables above. Re-run with the
        secrets configured in GitHub Actions repo settings, or contact the developer
        who built this artifact.
      </p>
      <p style="margin: 0; color: #6b7280; font-size: 13px;">
        Diagnostic log location: <code>%APPDATA%\\0studio\\logs\\main.log</code> (Windows)
        or <code>~/Library/Logs/0studio/main.log</code> (macOS).
      </p>
    </div>
  `;
}
