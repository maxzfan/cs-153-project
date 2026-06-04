import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRedactions, redactValue } from './log-redact.js';

test('redacts Bearer tokens', () => {
  const out = applyRedactions('Authorization: Bearer abc123.def-456_xyz');
  assert.equal(out, 'Authorization: Bearer <REDACTED>');
  assert.doesNotMatch(out, /abc123/);
});

test('redacts raw JWTs', () => {
  const jwt = 'eyJ' + 'A'.repeat(80) + '.signature';
  const out = applyRedactions(`token=${jwt} done`);
  assert.match(out, /<JWT_REDACTED>/);
  assert.doesNotMatch(out, /eyJA/);
});

test('redacts Supabase publishable and secret keys', () => {
  const out = applyRedactions('sb_publishable_abc123 and sb_secret_xyz789');
  assert.equal(out, 'sb_publishable_<REDACTED> and sb_secret_<REDACTED>');
});

test('redacts Stripe sk_ and rk_ keys but leaves pk_ alone', () => {
  const out = applyRedactions('sk_test_abc123 rk_live_def456 pk_test_safetolog');
  assert.match(out, /sk_test_<REDACTED>/);
  assert.match(out, /rk_live_<REDACTED>/);
  assert.match(out, /pk_test_safetolog/);
});

test('redacts refresh_token JSON values', () => {
  const out = applyRedactions('{"access_token":"a","refresh_token":"sensitive_rt_value"}');
  assert.match(out, /"refresh_token":"<REDACTED>"/);
  assert.doesNotMatch(out, /sensitive_rt_value/);
});

test('redacts OAuth artifacts in URLs', () => {
  const url =
    'https://example.com/cb?code=authcodeBLOB&code_verifier=verifierBLOB&state=stateBLOB&access_token=tokenBLOB';
  const out = applyRedactions(url);
  assert.doesNotMatch(out, /authcodeBLOB/);
  assert.doesNotMatch(out, /verifierBLOB/);
  assert.doesNotMatch(out, /stateBLOB/);
  assert.doesNotMatch(out, /tokenBLOB/);
  assert.match(out, /code=<REDACTED>/);
  assert.match(out, /code_verifier=<REDACTED>/);
  assert.match(out, /state=<REDACTED>/);
  assert.match(out, /access_token=<REDACTED>/);
});

test('redacts S3 presigned signature and credential', () => {
  const url =
    'https://x.s3.amazonaws.com/key?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA/region';
  const out = applyRedactions(url);
  assert.match(out, /X-Amz-Signature=<REDACTED>/);
  assert.match(out, /X-Amz-Credential=<REDACTED>/);
  assert.doesNotMatch(out, /deadbeef/);
  assert.doesNotMatch(out, /AKIA/);
});

test('redacts email addresses', () => {
  const out = applyRedactions('user reported by inky.kim+test@example.com about issue');
  assert.match(out, /<EMAIL_REDACTED>/);
  assert.doesNotMatch(out, /inky/);
});

test('redacts home-directory username on Mac/Linux/Windows', () => {
  assert.match(applyRedactions('/Users/inky/code/file.txt'), /\/Users\/<USER>\/code/);
  assert.match(applyRedactions('/home/inky/code/file.txt'), /\/home\/<USER>\/code/);
  assert.match(applyRedactions('C:\\Users\\inky\\code\\file.txt'), /C:\\Users\\<USER>\\code/);
});

test('redactValue scrubs Error message and stack but preserves type', () => {
  const err = new Error('failed with Bearer abcdef token');
  err.stack = 'Error: failed with Bearer abcdef token\n    at /Users/inky/code/file.ts:10:5';
  const scrubbed = redactValue(err);
  assert.ok(scrubbed instanceof Error);
  assert.match((scrubbed as Error).message, /Bearer <REDACTED>/);
  assert.doesNotMatch((scrubbed as Error).message, /abcdef/);
  assert.match((scrubbed as Error).stack ?? '', /\/Users\/<USER>\//);
});

test('redactValue scrubs nested objects without mutating original', () => {
  const original = {
    url: 'https://x.s3.amazonaws.com/?X-Amz-Signature=secret',
    headers: { Authorization: 'Bearer originalvalue' },
    body: { refresh_token: 'rt_xxx' },
  };
  const scrubbed = redactValue(original) as typeof original;
  assert.match(scrubbed.url, /X-Amz-Signature=<REDACTED>/);
  assert.match(scrubbed.headers.Authorization, /Bearer <REDACTED>/);
  assert.match(scrubbed.body.refresh_token, /<REDACTED>/);
  assert.equal(original.url, 'https://x.s3.amazonaws.com/?X-Amz-Signature=secret');
  assert.equal(original.headers.Authorization, 'Bearer originalvalue');
});

test('redactValue passes through primitives unchanged', () => {
  assert.equal(redactValue(42), 42);
  assert.equal(redactValue(true), true);
  assert.equal(redactValue(null), null);
  assert.equal(redactValue(undefined), undefined);
});
