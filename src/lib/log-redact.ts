/**
 * Renderer-side mirror of electron/lib/log-redact.ts. Kept in sync because the
 * electron and src trees can't share a TS module via tsconfig path aliases
 * (Vite resolves `src/`, electron tsc resolves `electron/`, and the two builds
 * don't cross). The 12 unit tests in electron/lib/log-redact.test.ts are the
 * canonical behavior fixture — if you change either copy, run those.
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

export function installRedactionHook(log: { hooks: unknown[] }): void {
  type MinimalMessage = { data: unknown[] };
  const hooks = log.hooks as Array<(message: MinimalMessage) => MinimalMessage>;
  hooks.push((message) => {
    message.data = message.data.map(redactValue);
    return message;
  });
}
