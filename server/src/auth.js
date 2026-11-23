import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './util.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, v: user.token_version }, config.jwtSecret, { expiresIn: '7d' });
}

// Charge l'utilisateur depuis la base à CHAQUE appel: rôle et suspension pris en compte immédiatement.
export async function loadUser(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return next();
    let payload;
    try { payload = jwt.verify(h.slice(7), config.jwtSecret); } catch { return next(); }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.phone, u.email, u.pi_uid, u.pi_username, u.role, u.is_active, u.token_version,
              s.id AS seller_id, s.is_active AS seller_active
       FROM users u LEFT JOIN sellers s ON s.user_id = u.id WHERE u.id = $1`, [payload.sub]);
    const u = rows[0];
    if (u && u.is_active && u.token_version === payload.v) req.user = u;
    next();
  } catch (e) { next(e); }
}

export const requireAuth = (req, _res, next) =>
  req.user ? next() : next(new HttpError(401, 'Connexion requise.', 'unauthenticated'));

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Connexion requise.', 'unauthenticated'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Accès refusé.', 'forbidden'));
  if (req.user.role === 'seller' && !req.user.seller_active) return next(new HttpError(403, 'Compte vendeur désactivé.', 'seller_disabled'));
  next();
};

export const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, phone: u.phone, email: u.email,
  pi_username: u.pi_username, has_pi: !!u.pi_uid, role: u.role, seller_id: u.seller_id || null,
});
