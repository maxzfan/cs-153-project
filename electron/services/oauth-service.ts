import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';
import log from 'electron-log/main.js';

/**
 * Loopback PKCE OAuth flow for Google sign-in via Supabase.
 *
 * Why loopback over `redirectTo: window.location.origin`:
 *   In packaged Electron, window.location.origin resolves to `file://`. Google
 *   refuses to redirect to file:// URIs and produces a white screen on Mac DMG
 *   today (verified — see docs/handoffs/2026-04-26-windows-tester-round-1.md
 *   §0a). Loopback works identically dev / packaged / Mac / Windows.
 *
 * Why exchange in main process:
 *   The verifier-into-supabase-js storage hack the original plan tried relies
 *   on undocumented internal keys. Calling Supabase's /auth/v1/token endpoint
 *   directly via fetch() with our own verifier sidesteps that entirely. The
 *   renderer just calls supabase.auth.setSession() with the returned tokens.
 *
 * Hardening:
 *   - Only one flow in flight at a time (double-click guard).
 *   - 16-byte state for CSRF; mismatch rejects with 400.
 *   - Single-shot: any second request after consumption returns 410 Gone.
 *   - Host header validation: rejects requests not addressed to our 127.0.0.1:port.
 *   - Path validation: only /auth-callback is honored.
 *   - shell.openExternal URL validated against an allowlist (https + Supabase host).
 *   - 3-minute timeout (down from 5 in the plan — narrower attack surface).
 *   - All open servers tracked in a Set; shutdown helpers tear them all down on
 *     before-quit, render-process-gone, and webContents:destroyed.
 *   - closeAllConnections() after success/error/timeout so socket TIME_WAIT
 *     doesn't keep the port alive (Node ≥18.2).
 */

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  user: unknown;
}

export interface OAuthError {
  code:
    | 'OAUTH_IN_FLIGHT'
    | 'OAUTH_STATE_MISMATCH'
    | 'OAUTH_EXCHANGE_FAILED'
    | 'OAUTH_TIMEOUT'
    | 'OAUTH_CANCELLED'
    | 'OAUTH_BLOCKED_URL'
    | 'OAUTH_LISTEN_FAILED';
  message: string;
}

const TIMEOUT_MS = 3 * 60_000;
const REDIRECT_PATH = '/auth-callback';

const openServers = new Set<http.Server>();
let inFlight: Promise<TokenPair> | null = null;
let activeAbort: (() => void) | null = null;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

const SUCCESS_HTML = `<!doctype html><html><head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="referrer" content="no-referrer">
  <title>Signed in to 0studio</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center;padding:80px;color:#1a1a1a}
    h2{font-weight:600;margin-bottom:8px}
    p{color:#555}
  </style>
  </head><body><h2>Signed in to 0studio</h2><p>You can close this tab and return to the app.</p></body></html>`;

function buildSupabaseAuthUrl(
  supabaseUrl: string,
  redirect: string,
  challenge: string,
  state: string,
): string {
  const u = new URL(`${supabaseUrl}/auth/v1/authorize`);
  u.searchParams.set('provider', 'google');
  u.searchParams.set('redirect_to', redirect);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  // Match prior behavior — request a refresh-token-bearing offline grant and
  // force consent so Google emits a refresh_token even on subsequent sign-ins.
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

/**
 * Begin a Google sign-in. Returns a TokenPair on success or rejects with an
 * OAuthError-shaped error. Idempotent under double-click — a second call while
 * a flow is in flight returns the same in-flight promise.
 */
export function startGoogleSignIn(supabaseUrl: string, anonKey: string): Promise<TokenPair> {
  if (inFlight) {
    log.info('[oauth] startGoogleSignIn called while flow in flight; returning existing promise');
    return inFlight;
  }

  const allowedAuthHost = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return null;
    }
  })();

  if (!allowedAuthHost) {
    return Promise.reject<TokenPair>(
      Object.assign(new Error('invalid supabase URL'), { code: 'OAUTH_BLOCKED_URL' }),
    );
  }

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  let consumed = false;

  inFlight = new Promise<TokenPair>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (consumed) {
        res.writeHead(410, securityHeaders());
        res.end('Gone');
        return;
      }

      const expectedHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.headers.host !== expectedHost) {
        res.writeHead(400, securityHeaders());
        res.end('bad host');
        return;
      }

      if (!req.url) {
        res.writeHead(400, securityHeaders());
        res.end('bad request');
        return;
      }

      const url = new URL(req.url, `http://${expectedHost}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404, securityHeaders());
        res.end('Not found');
        return;
      }
      consumed = true;

      const incomingState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const errParam = url.searchParams.get('error');

      if (errParam) {
        res.writeHead(400, securityHeaders());
        res.end(`Sign-in failed: ${errParam}`);
        cleanup();
        reject(
          Object.assign(new Error(`provider error: ${errParam}`), {
            code: 'OAUTH_EXCHANGE_FAILED',
          }),
        );
        return;
      }

      if (incomingState !== state || !code) {
        res.writeHead(400, securityHeaders());
        res.end('Sign-in rejected (state mismatch)');
        cleanup();
        reject(
          Object.assign(new Error('state mismatch'), { code: 'OAUTH_STATE_MISMATCH' }),
        );
        return;
      }

      // PKCE token exchange — direct fetch to Supabase. Bypasses supabase-js
      // storage entirely so the renderer never needs to know our verifier.
      try {
        const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
        });
        if (!tokenRes.ok) {
          const text = await tokenRes.text().catch(() => '');
          throw new Error(`token endpoint ${tokenRes.status}: ${text.slice(0, 200)}`);
        }
        const data = (await tokenRes.json()) as {
          access_token: string;
          refresh_token: string;
          user: unknown;
        };
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders() });
        res.end(SUCCESS_HTML);
        cleanup();
        resolve({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: data.user,
        });
      } catch (err) {
        res.writeHead(500, securityHeaders());
        res.end('Sign-in exchange failed');
        cleanup();
        reject(
          Object.assign(err as Error, { code: 'OAUTH_EXCHANGE_FAILED' }),
        );
      }
    });

    openServers.add(server);

    const timeout = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('oauth timeout'), { code: 'OAUTH_TIMEOUT' }));
    }, TIMEOUT_MS);

    activeAbort = () => {
      cleanup();
      reject(Object.assign(new Error('oauth cancelled'), { code: 'OAUTH_CANCELLED' }));
    };

    function cleanup() {
      clearTimeout(timeout);
      openServers.delete(server);
      activeAbort = null;
      // Node ≥18.2 — drops sockets in TIME_WAIT immediately so the ephemeral
      // port can be reused if the user retries quickly.
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close();
      inFlight = null;
    }

    server.on('error', (err) => {
      cleanup();
      reject(Object.assign(err, { code: 'OAUTH_LISTEN_FAILED' }));
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}${REDIRECT_PATH}`;
      const authUrl = buildSupabaseAuthUrl(supabaseUrl, redirect, challenge, state);
      const parsed = new URL(authUrl);
      if (parsed.protocol !== 'https:' || parsed.host !== allowedAuthHost) {
        cleanup();
        reject(
          Object.assign(new Error(`blocked auth URL host: ${parsed.host}`), {
            code: 'OAUTH_BLOCKED_URL',
          }),
        );
        return;
      }
      log.info('[oauth] opening external browser for Google sign-in', { redirect });
      shell.openExternal(authUrl).catch((err) => {
        log.error('[oauth] shell.openExternal failed:', err);
        cleanup();
        reject(
          Object.assign(err as Error, { code: 'OAUTH_LISTEN_FAILED' }),
        );
      });
    });
  });

  return inFlight;
}

/** Cancel any in-flight Google sign-in. Idempotent — no-op if nothing is running. */
export function cancelGoogleSignIn(): void {
  activeAbort?.();
}

/**
 * Tear down every loopback server we know about. Wired to before-quit,
 * render-process-gone, and webContents:destroyed so an orphan listener never
 * outlives the renderer.
 */
export function shutdownAllOAuthServers(): void {
  for (const server of openServers) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close();
  }
  openServers.clear();
  activeAbort = null;
  inFlight = null;
}
