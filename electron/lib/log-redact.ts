/**
 * Privacy redaction for log lines. Strips secrets, tokens, and PII before
 * anything reaches the on-disk log file or a copied diagnostic report.
 *
 * Patterns (kept in step with the test fixture in log-redact.test.ts):
 *  1. Bearer tokens in Authorization headers
 *  2. Raw JWTs (anything starting with eyJ followed by 60+ base64url chars)
 *  3. Supabase publishable + secret keys
 *  4. Stripe restricted + secret keys (sk_/rk_ test/live) — pk_* (publishable) is
 *     NOT redacted because it's safe to log and used to debug client config
 *  5. refresh_token JSON values
 *  6. OAuth / Supabase callback artifacts in URLs
 *  7. S3 presigned URL signatures + credentials
 *  8. Email addresses
 *  9. Home directory username segments (Mac, Linux, Windows)
 */
export function applyRedactions(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <REDACTED>')
    .replace(/eyJ[A-Za-z0-9._-]{60,}/g, '<JWT_REDACTED>')
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_]+/g, 'sb_$1_<REDACTED>')
    .replace(/(sk|rk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_<REDACTED>')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, '"refresh_token":"<REDACTED>"')
    .replace(
      /([?&])(code|code_verifier|state|access_token|refresh_token)=[^&\s]+/gi,
      '$1$2=<REDACTED>',
    )
    .replace(/X-Amz-Signature=[A-Za-z0-9]+/g, 'X-Amz-Signature=<REDACTED>')
    .replace(/X-Amz-Credential=[^&\s]+/g, 'X-Amz-Credential=<REDACTED>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<EMAIL_REDACTED>')
    .replace(/(\/Users\/|\/home\/|C:\\Users\\)([^/\\]+)/g, '$1<USER>');
}

/**
 * Recursively scrub an arbitrary log argument. Strings and Errors get scrubbed
 * directly; objects round-trip through JSON to scrub nested secrets without
 * mutating the original (mutation would surprise callers who keep a reference).
 */
export function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return applyRedactions(v);
  if (v instanceof Error) {
    const next = new Error(applyRedactions(v.message));
    next.stack = v.stack ? applyRedactions(v.stack) : undefined;
    next.name = v.name;
    return next;
  }
  if (v && typeof v === 'object') {
    try {
      return JSON.parse(applyRedactions(JSON.stringify(v)));
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * Install the redaction hook on an electron-log instance. Called once on the
 * main side (electron-log/main) and once on the renderer side (electron-log/renderer).
 *
 * The cast is necessary because electron-log's `Hook` type carries fields we
 * don't care about (`date`, `level`, `scope`, ...). Modeling them all here
 * would couple this module to electron-log's exact version-by-version shape;
 * in practice we only ever read/write `data`.
 */
export function installRedactionHook(log: { hooks: unknown[] }): void {
  type MinimalMessage = { data: unknown[] };
  const hooks = log.hooks as Array<(message: MinimalMessage) => MinimalMessage>;
  hooks.push((message) => {
    message.data = message.data.map(redactValue);
    return message;
  });
}
