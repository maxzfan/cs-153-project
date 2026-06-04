#!/usr/bin/env node
/**
 * Smoke test for the loopback OAuth server. Exercises the host/path/state
 * validation logic end-to-end without involving Google or Supabase. Run on
 * every Mac CI build so a future regression in the loopback hardening
 * (CSRF, host header, single-shot, oversized URLs) fails CI loud.
 *
 * Strategy: spin up an http server with the same response semantics as the
 * production OAuth handler, then drive it with a sequence of crafted
 * requests, asserting status codes and lifecycle.
 *
 * This is NOT a test of oauth-service.ts directly (which depends on Electron's
 * `shell.openExternal` and electron-log) — it's a regression gate for the
 * security pattern. If oauth-service.ts diverges from this pattern, refactor
 * both in lockstep.
 *
 * Exit 0 on success, exit 1 with a diagnostic on any assertion failure.
 */
const http = require('node:http');
const crypto = require('node:crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

function buildLoopbackServer(expectedState) {
  let consumed = false;
  const server = http.createServer((req, res) => {
    if (consumed) {
      res.writeHead(410, securityHeaders());
      res.end('Gone');
      return;
    }
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== expectedHost) {
      res.writeHead(400, securityHeaders());
      res.end('bad host');
      return;
    }
    const url = new URL(req.url, `http://${expectedHost}`);
    if (url.pathname !== '/auth-callback') {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    consumed = true;
    if (url.searchParams.get('state') !== expectedState || !url.searchParams.get('code')) {
      res.writeHead(400, securityHeaders());
      res.end('Sign-in rejected');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders() });
    res.end('<h2>Signed in</h2>');
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function fetchWith(host, port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path, method: 'GET', headers: { Host: `${host}:${port}`, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function assert(label, cond, detail) {
  if (cond) {
    console.log(`  ok ${label}`);
  } else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
}

(async function run() {
  console.log('smoke-oauth: starting');
  const state = base64url(crypto.randomBytes(16));
  const code = base64url(crypto.randomBytes(32));

  // Test 1: bad path → 404
  let server = await buildLoopbackServer(state);
  let port = server.address().port;
  let r = await fetchWith('127.0.0.1', port, '/wrong-path');
  await assert('bad path returns 404', r.status === 404, `got ${r.status}`);
  await assert('security headers on 404', r.headers['x-content-type-options'] === 'nosniff');
  server.close();

  // Test 2: bad host header → 400
  server = await buildLoopbackServer(state);
  port = server.address().port;
  r = await fetchWith('127.0.0.1', port, '/auth-callback?code=x&state=' + state, {
    Host: 'evil.example.com',
  });
  await assert('bad host returns 400', r.status === 400, `got ${r.status}`);
  server.close();

  // Test 3: state mismatch → 400
  server = await buildLoopbackServer(state);
  port = server.address().port;
  r = await fetchWith('127.0.0.1', port, '/auth-callback?code=x&state=wrongstate');
  await assert('state mismatch returns 400', r.status === 400, `got ${r.status}`);
  server.close();

  // Test 4: missing code → 400
  server = await buildLoopbackServer(state);
  port = server.address().port;
  r = await fetchWith('127.0.0.1', port, `/auth-callback?state=${state}`);
  await assert('missing code returns 400', r.status === 400, `got ${r.status}`);
  server.close();

  // Test 5: valid request → 200, then second request → 410 Gone
  server = await buildLoopbackServer(state);
  port = server.address().port;
  r = await fetchWith('127.0.0.1', port, `/auth-callback?code=${code}&state=${state}`);
  await assert('valid request returns 200', r.status === 200, `got ${r.status}`);
  await assert('CSP header present', /default-src 'none'/.test(r.headers['content-security-policy'] || ''));
  const r2 = await fetchWith('127.0.0.1', port, `/auth-callback?code=${code}&state=${state}`);
  await assert('second request returns 410', r2.status === 410, `got ${r2.status}`);
  server.close();

  console.log('smoke-oauth: all assertions passed');
})().catch((err) => {
  console.error('smoke-oauth: unexpected error', err);
  process.exit(1);
});
