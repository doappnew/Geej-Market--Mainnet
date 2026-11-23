import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import multer from 'multer';
import { config } from './config.js';
import { query } from './db.js';
import { loadUser } from './auth.js';
import { HttpError } from './util.js';
import { uploadDir } from './storage.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import meRoutes from './routes/me.js';
import payRoutes from './routes/pay.js';
import sellerRoutes from './routes/seller.js';
import adminRoutes from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://sdk.minepi.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'", 'https://api.minepi.com', 'https://sdk.minepi.com', 'https://socialchain.app', 'https://*.minepi.com'],
        'frame-src': ["'self'", 'https://sdk.minepi.com', 'https://app-cdn.minepi.com'],
        'frame-ancestors': ["'self'", 'https://*.minepi.com', 'https://*.pinet.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.', code: 'rate_limited' } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/pi', authLimiter);

  app.use('/api', loadUser);
  app.use('/api/auth', authRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/checkout', orderRoutes); // /api/checkout/quote
  app.use('/api/me', meRoutes);
  app.use('/api/pay', payRoutes);
  app.use('/api/seller', sellerRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route introuvable.', 'not_found')));

  // Vérification de domaine Pi Developer Portal
  app.get('/validation-key.txt', (_req, res) => {
    if (!config.piValidationKey) return res.status(404).type('text/plain').send('not configured');
    res.type('text/plain').send(config.piValidationKey);
  });

  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', index: false, setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));

  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); else if (/\/assets\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(clientDist, 'index.html')); });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return res.status(400).json({ error: issues[0]?.message || 'Données invalides.', code: 'validation', issues });
    }
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (8 Mo max).' : 'Envoi de fichier invalide.', code: 'upload' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.problems ? { problems: err.problems } : {}) });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.', code: 'bad_json' });
    console.error('Erreur serveur:', req.method, req.path, err?.code || '', err?.message);
    res.status(500).json({ error: 'Erreur interne. Réessayez plus tard.', code: 'internal' });
  });
  return app;
}
