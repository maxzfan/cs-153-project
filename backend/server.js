import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { S3Client } from '@aws-sdk/client-s3';
import { SESClient } from '@aws-sdk/client-ses';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createAuthMiddleware } from './middleware/auth.js';
import { createUtils } from './lib/utils.js';
import { createS3Routes } from './routes/s3.js';
import { createProjectRoutes } from './routes/projects.js';
import { createSyncRoutes } from './routes/sync.js';
import { createStripeRoutes } from './routes/stripe.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });

// ---------------------------------------------------------------------------
// Middleware & utils factories
// ---------------------------------------------------------------------------
const { verifyAuth, validateS3Key, checkProjectPermission, verifySubscription } = createAuthMiddleware(supabase);

const INVITE_FROM_EMAIL = process.env.INVITE_FROM_EMAIL;
const { resolvePendingInvites, sendProjectInviteEmail, ensureS3Cors } = createUtils({
  supabase, sesClient, s3Client, BUCKET_NAME, INVITE_FROM_EMAIL,
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

// CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Electron file://, server-to-server)
    // but NOT 'null' string origins (sandboxed iframes, data: URIs)
    if (!origin) return callback(null, true);
    const allowed = [process.env.FRONTEND_URL || 'http://localhost:5173'];
    if (allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/aws', limiter);
app.use('/api/projects', limiter);

// Stripe webhook needs raw body for signature verification — must come before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public landing page Supabase redirects to after a signup confirmation click.
// `window.location.origin` is unreachable from a user's email client in an
// Electron app (file:// in prod, localhost in dev), so the desktop app's
// signUp() points emailRedirectTo here.
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
      // Scrub the fragment first — Supabase puts a JWT in the success fragment.
      if (hash) history.replaceState(null, '', window.location.pathname);
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

// Route modules
app.use('/api/aws', createS3Routes({ s3Client, BUCKET_NAME, verifyAuth, validateS3Key }));
app.use('/api/projects', createProjectRoutes({ supabase, verifyAuth, checkProjectPermission, verifySubscription, resolvePendingInvites, sendProjectInviteEmail }));
app.use('/api/projects/:projectId/sync', limiter, createSyncRoutes({ s3Client, BUCKET_NAME, verifyAuth, checkProjectPermission, verifySubscription }));
app.use('/api/stripe', createStripeRoutes({ stripe, supabase, verifyAuth }));

// Error handling
app.use((_err, _req, res, _next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
ensureS3Cors();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
