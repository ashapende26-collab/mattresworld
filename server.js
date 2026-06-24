/**
 * Mattress World — Server (Render deployment)
 * --------------------------------------------------
 * API-only backend. The frontend is hosted separately on Netlify.
 * CORS is enabled so Netlify can call this API.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const ACCOUNT_FILE = path.join(__dirname, 'data', 'admin-account.json');

/* ---------------------------------------------------------------------- */
/* CORS — allow requests from your Netlify frontend                       */
/* ---------------------------------------------------------------------- */

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '';

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow the configured Netlify URL, or any origin if FRONTEND_URL is not set (dev mode)
  if (!ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------------------------------------------------------------------- */
/* Admin account                                                          */
/* ---------------------------------------------------------------------- */

function loadOrInitAccount() {
  let account = null;
  try {
    account = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf-8'));
  } catch {
    account = null;
  }

  if (!account) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const passwordHash =
      process.env.ADMIN_PASSWORD_HASH ||
      (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) : null);

    if (!passwordHash) {
      console.warn(
        '\n[mattress-world] WARNING: No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH set in .env.\n' +
        'The admin panel login will reject every attempt until you set one and restart.\n'
      );
    }

    account = {
      username,
      passwordHash: passwordHash || null,
      recoveryCodeHash: process.env.RECOVERY_CODE ? bcrypt.hashSync(process.env.RECOVERY_CODE, 10) : null,
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true });
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
    return account;
  }

  if (!account.recoveryCodeHash && process.env.RECOVERY_CODE) {
    account.recoveryCodeHash = bcrypt.hashSync(process.env.RECOVERY_CODE, 10);
    account.updatedAt = new Date().toISOString();
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
  }

  return account;
}

function saveAccount(account) {
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
}

let adminAccount = loadOrInitAccount();

app.disable('x-powered-by');
app.use(express.json());
app.use(
  session({
    name: 'mw.sid',
    secret: process.env.SESSION_SECRET || 'please-change-this-secret-before-launch',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

/* ---------------------------------------------------------------------- */
/* Data helpers                                                           */
/* ---------------------------------------------------------------------- */

function readProducts() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[mattress-world] Could not read products.json:', err.message);
    return [];
  }
}

function writeProducts(products) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
}

function makeId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------------------------------------------------------------- */
/* Auth middleware                                                        */
/* ---------------------------------------------------------------------- */

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'You must be logged in as admin to do this.' });
}

/* ---------------------------------------------------------------------- */
/* Rate limiting                                                          */
/* ---------------------------------------------------------------------- */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function makeRateLimiter() {
  const attempts = new Map();
  return {
    middleware(req, res, next) {
      const ip = req.ip;
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now > entry.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return next();
      }
      if (entry.count >= MAX_ATTEMPTS) {
        const minutesLeft = Math.ceil((entry.resetAt - now) / 60000);
        return res.status(429).json({ error: `Too many attempts. Try again in ${minutesLeft} minute(s).` });
      }
      entry.count += 1;
      next();
    },
    reset(ip) {
      attempts.delete(ip);
    }
  };
}

const loginLimiter = makeRateLimiter();
const forgotPasswordLimiter = makeRateLimiter();

/* ---------------------------------------------------------------------- */
/* Auth routes                                                            */
/* ---------------------------------------------------------------------- */

app.post('/api/login', loginLimiter.middleware, (req, res) => {
  const { username, password } = req.body || {};
  if (!adminAccount.passwordHash) {
    return res.status(500).json({ error: 'Admin login is not configured on the server yet.' });
  }
  const validUsername = username === adminAccount.username;
  const validPassword = validUsername && bcrypt.compareSync(String(password || ''), adminAccount.passwordHash);
  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  req.session.isAdmin = true;
  loginLimiter.reset(req.ip);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post('/api/forgot-password', forgotPasswordLimiter.middleware, (req, res) => {
  const { username, recoveryCode, newPassword } = req.body || {};
  if (!adminAccount.recoveryCodeHash) {
    return res.status(500).json({ error: 'Password recovery is not set up. Add RECOVERY_CODE to .env and restart.' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const validUsername = username === adminAccount.username;
  const validCode = validUsername && bcrypt.compareSync(String(recoveryCode || ''), adminAccount.recoveryCodeHash);
  if (!validUsername || !validCode) {
    return res.status(401).json({ error: 'Incorrect username or recovery code.' });
  }
  adminAccount.passwordHash = bcrypt.hashSync(String(newPassword), 10);
  adminAccount.updatedAt = new Date().toISOString();
  saveAccount(adminAccount);
  forgotPasswordLimiter.reset(req.ip);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------------- */
/* Product routes                                                         */
/* ---------------------------------------------------------------------- */

app.get('/api/products', (req, res) => {
  res.json(readProducts());
});

app.post('/api/products', requireAuth, (req, res) => {
  const body = req.body || {};
  if (!body.title || !String(body.title).trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }
  const products = readProducts();
  const product = {
    id: makeId(),
    title: String(body.title).trim(),
    description: body.description || '',
    image: body.image || '',
    affiliateUrl: body.affiliateUrl || '#',
    buttonText: body.buttonText || 'See Price',
    rating: Math.max(0, Math.min(5, Number(body.rating) || 0)),
    ratingCount: body.ratingCount || '',
    badge: body.badge || '',
    badgeColor: body.badgeColor || 'dark',
    specs: Array.isArray(body.specs) ? body.specs : []
  };
  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const products = readProducts();
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found.' });
  const body = req.body || {};
  if (body.title !== undefined && !String(body.title).trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }
  products[idx] = {
    ...products[idx],
    ...body,
    id: products[idx].id,
    rating:
      body.rating !== undefined
        ? Math.max(0, Math.min(5, Number(body.rating) || 0))
        : products[idx].rating
  };
  writeProducts(products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const products = readProducts();
  const next = products.filter((p) => p.id !== req.params.id);
  if (next.length === products.length) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  writeProducts(next);
  res.json({ ok: true });
});

app.put('/api/products-order', requireAuth, (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array of product ids.' });
  }
  const products = readProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const missing = products.filter((p) => !orderedIds.includes(p.id));
  writeProducts([...reordered, ...missing]);
  res.json(readProducts());
});

/* ---------------------------------------------------------------------- */
/* Health check                                                           */
/* ---------------------------------------------------------------------- */

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.listen(PORT, () => {
  console.log(`Mattress World API running at http://localhost:${PORT}`);
});
