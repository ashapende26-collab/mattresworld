/**
 * Mattress World — Server
 * MongoDB + Cloudinary image uploads
 */

require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const MongoStore   = require('connect-mongo');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const multer       = require('multer');
const cloudinary   = require('cloudinary').v2;

const app  = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Cloudinary config                                                   */
/* ------------------------------------------------------------------ */

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

/* ------------------------------------------------------------------ */
/* MongoDB + Mongoose                                                  */
/* ------------------------------------------------------------------ */

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({
  title       : { type: String, required: true },
  description : { type: String, default: '' },
  image       : { type: String, default: '' },
  affiliateUrl: { type: String, default: '#' },
  buttonText  : { type: String, default: 'See Price' },
  rating      : { type: Number, default: 0, min: 0, max: 5 },
  ratingCount : { type: String, default: '' },
  badge       : { type: String, default: '' },
  badgeColor  : { type: String, default: 'dark' },
  specs       : { type: Array, default: [] },
  order       : { type: Number, default: 0 },
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

const adminSchema = new mongoose.Schema({
  username        : String,
  passwordHash    : String,
  recoveryCodeHash: String,
}, { timestamps: true });

const Admin = mongoose.model('Admin', adminSchema);

/* ------------------------------------------------------------------ */
/* Ensure admin account exists on startup                             */
/* ------------------------------------------------------------------ */

async function ensureAdmin() {
  let account = await Admin.findOne();
  if (account) {
    // Add recovery code if missing
    if (!account.recoveryCodeHash && process.env.RECOVERY_CODE) {
      account.recoveryCodeHash = bcrypt.hashSync(process.env.RECOVERY_CODE, 10);
      await account.save();
    }
    return;
  }

  const username     = process.env.ADMIN_USERNAME || 'admin';
  const password     = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[mattress-world] WARNING: ADMIN_PASSWORD not set. Admin login disabled until you set it and restart.');
  }
  const passwordHash     = password ? bcrypt.hashSync(password, 10) : null;
  const recoveryCodeHash = process.env.RECOVERY_CODE ? bcrypt.hashSync(process.env.RECOVERY_CODE, 10) : null;

  await Admin.create({ username, passwordHash, recoveryCodeHash });
  console.log(`Admin account created: ${username}`);
}

/* ------------------------------------------------------------------ */
/* CORS                                                                */
/* ------------------------------------------------------------------ */

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '';

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

app.use(session({
  name  : 'mw.sid',
  secret: process.env.SESSION_SECRET || 'please-change-this-secret',
  resave: false,
  saveUninitialized: false,
  store : MongoStore.create({
    mongoUrl   : process.env.MONGODB_URI,
    ttl        : 8 * 60 * 60,        // 8 hours
    autoRemove : 'native',
  }),
  cookie: {
    httpOnly : true,
    sameSite : 'none',
    secure   : true,
    maxAge   : 8 * 60 * 60 * 1000,
  },
}));

/* ------------------------------------------------------------------ */
/* Rate limiter                                                        */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 8;
const WINDOW_MS    = 10 * 60 * 1000;

function makeRateLimiter() {
  const attempts = new Map();
  return {
    middleware(req, res, next) {
      const ip  = req.ip;
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
    reset(ip) { attempts.delete(ip); },
  };
}

const loginLimiter          = makeRateLimiter();
const forgotPasswordLimiter = makeRateLimiter();

/* ------------------------------------------------------------------ */
/* Auth middleware                                                     */
/* ------------------------------------------------------------------ */

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'You must be logged in as admin.' });
}

/* ------------------------------------------------------------------ */
/* Image upload via Cloudinary                                        */
/* ------------------------------------------------------------------ */

// Store file in memory, then stream to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// POST /api/upload  (admin only)
app.post('/api/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'mattress-world', resource_type: 'image' },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Image upload failed. Check Cloudinary credentials.' });
  }
});

/* ------------------------------------------------------------------ */
/* Auth routes                                                         */
/* ------------------------------------------------------------------ */

app.post('/api/login', loginLimiter.middleware, async (req, res) => {
  const { username, password } = req.body || {};
  const account = await Admin.findOne();
  if (!account || !account.passwordHash) {
    return res.status(500).json({ error: 'Admin login not configured.' });
  }
  const valid = username === account.username && bcrypt.compareSync(String(password || ''), account.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect username or password.' });

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

app.post('/api/forgot-password', forgotPasswordLimiter.middleware, async (req, res) => {
  const { username, recoveryCode, newPassword } = req.body || {};
  const account = await Admin.findOne();
  if (!account || !account.recoveryCodeHash) {
    return res.status(500).json({ error: 'Password recovery not set up. Add RECOVERY_CODE to env vars.' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const valid = username === account.username && bcrypt.compareSync(String(recoveryCode || ''), account.recoveryCodeHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect username or recovery code.' });

  account.passwordHash = bcrypt.hashSync(String(newPassword), 10);
  await account.save();
  forgotPasswordLimiter.reset(req.ip);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Product routes                                                      */
/* ------------------------------------------------------------------ */

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ order: 1, createdAt: 1 });
  res.json(products);
});

app.post('/api/products', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (!body.title || !String(body.title).trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }
  const count   = await Product.countDocuments();
  const product = await Product.create({
    title       : String(body.title).trim(),
    description : body.description || '',
    image       : body.image || '',
    affiliateUrl: body.affiliateUrl || '#',
    buttonText  : body.buttonText || 'See Price',
    rating      : Math.max(0, Math.min(5, Number(body.rating) || 0)),
    ratingCount : body.ratingCount || '',
    badge       : body.badge || '',
    badgeColor  : body.badgeColor || 'dark',
    specs       : Array.isArray(body.specs) ? body.specs : [],
    order       : count,
  });
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (body.title !== undefined && !String(body.title).trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { ...body, ...(body.rating !== undefined && { rating: Math.max(0, Math.min(5, Number(body.rating) || 0)) }) },
    { new: true }
  );
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json(product);
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ok: true });
});

app.put('/api/products-order', requireAuth, async (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array.' });
  }
  await Promise.all(orderedIds.map((id, index) => Product.findByIdAndUpdate(id, { order: index })));
  const products = await Product.find().sort({ order: 1 });
  res.json(products);
});

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

mongoose.connection.once('open', async () => {
  await ensureAdmin();
  app.listen(PORT, () => console.log(`Mattress World API running on port ${PORT}`));
});
