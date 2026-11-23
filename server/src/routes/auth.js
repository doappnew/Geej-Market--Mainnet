import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { signToken, requireAuth, publicUser } from '../auth.js';
import { HttpError, asyncH, normalizePhone } from '../util.js';
import { audit } from '../audit.js';
import { piMe } from '../pi.js';

const r = Router();

// Les pionniers se connectent UNIQUEMENT avec leur compte Pi. Le mot de passe ne sert qu'à l'équipe (vendeur / admin).
// ALLOW_PASSWORD_CLIENTS=1 réserve l'inscription/connexion par mot de passe aux tests automatisés.
const passwordClients = () => process.env.ALLOW_PASSWORD_CLIENTS === '1';

const phoneField = z.string().trim().min(1).transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone sénégalais invalide (ex: 77 123 45 67).' });
  return p;
});
const passwordField = z.string().min(8, 'Mot de passe: 8 caractères minimum.').max(100);

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  phone: phoneField,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
  password: passwordField,
  accept_terms: z.literal(true, { errorMap: () => ({ message: "Vous devez accepter les conditions d'utilisation." }) }),
});

const fullUser = async (id) => (await query(
  `SELECT u.id, u.full_name, u.phone, u.email, u.pi_uid, u.pi_username, u.role, u.token_version, s.id AS seller_id
   FROM users u LEFT JOIN sellers s ON s.user_id = u.id WHERE u.id = $1`, [id])).rows[0];

r.post('/register', asyncH(async (req, res) => {
  if (!passwordClients()) throw new HttpError(403, 'Inscription par mot de passe indisponible : connectez-vous avec votre compte Pi.', 'pi_only');
  const d = registerSchema.parse(req.body);
  try {
    const ins = await query(
      `INSERT INTO users(full_name, phone, email, password_hash, role) VALUES ($1,$2,$3,$4,'client') RETURNING id`,
      [d.full_name, d.phone, d.email || null, await bcrypt.hash(d.password, 12)]);
    const u = await fullUser(ins.rows[0].id);
    await audit({ user: u, ip: req.ip }, 'auth.register', 'user', u.id);
    res.status(201).json({ token: signToken(u), user: publicUser(u) });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Un compte existe déjà avec ce téléphone ou cet e-mail.', 'duplicate');
    throw e;
  }
}));

r.post('/login', asyncH(async (req, res) => {
  const { identifier, password } = z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(1).max(100) }).parse(req.body);
  const isEmail = identifier.includes('@');
  const key = isEmail ? identifier.toLowerCase() : normalizePhone(identifier);
  const bad = () => new HttpError(401, 'Identifiants incorrects.', 'bad_credentials');
  if (!key) throw bad();
  const { rows } = await query(`SELECT id, role, password_hash, is_active FROM users WHERE ${isEmail ? 'email' : 'phone'} = $1`, [key]);
  const u = rows[0];
  const ok = u?.password_hash ? await bcrypt.compare(password, u.password_hash) : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!u || !ok) { await audit({ ip: req.ip }, 'auth.login_failed', 'user', u?.id ?? null); throw bad(); }
  if (!u.is_active) throw new HttpError(403, 'Compte suspendu. Contactez le service client.', 'suspended');
  if (u.role === 'client' && !passwordClients()) throw new HttpError(403, 'Connexion par mot de passe réservée à l’équipe. Utilisez votre compte Pi.', 'pi_only');
  const full = await fullUser(u.id);
  await audit({ user: full, ip: req.ip }, 'auth.login', 'user', full.id);
  res.json({ token: signToken(full), user: publicUser(full) });
}));

// Connexion avec Pi: le serveur vérifie lui-même l'accessToken auprès de Pi (/v2/me). Rien n'est lu depuis le navigateur.
r.post('/pi', asyncH(async (req, res) => {
  const { accessToken } = z.object({ accessToken: z.string().min(10).max(4000) }).parse(req.body);
  let me;
  try { me = await piMe(accessToken); } catch (e) {
    if (e.piStatus === 401 || e.piStatus === 403) throw new HttpError(401, 'Authentification Pi refusée.', 'pi_auth_failed');
    throw e;
  }
  if (!me?.uid) throw new HttpError(502, 'Réponse Pi inattendue.', 'pi_bad_response');
  let { rows } = await query('SELECT id, is_active FROM users WHERE pi_uid = $1', [me.uid]);
  let id;
  if (!rows[0]) {
    const ins = await query(`INSERT INTO users(full_name, pi_uid, pi_username, role) VALUES ($1,$2,$3,'client') RETURNING id`, [me.username || 'Pionnier Pi', me.uid, me.username || null]);
    id = ins.rows[0].id;
    await audit({ ip: req.ip }, 'auth.register_pi', 'user', id);
  } else {
    if (!rows[0].is_active) throw new HttpError(403, 'Compte suspendu.', 'suspended');
    id = rows[0].id;
    if (me.username) await query('UPDATE users SET pi_username = $1 WHERE id = $2', [me.username, id]);
  }
  const u = await fullUser(id);
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// Rattacher un compte Pi à un compte existant (téléphone / e-mail)
r.post('/pi/link', requireAuth, asyncH(async (req, res) => {
  const { accessToken } = z.object({ accessToken: z.string().min(10).max(4000) }).parse(req.body);
  const me = await piMe(accessToken);
  if (!me?.uid) throw new HttpError(502, 'Réponse Pi inattendue.', 'pi_bad_response');
  try {
    await query('UPDATE users SET pi_uid = $1, pi_username = $2 WHERE id = $3', [me.uid, me.username || null, req.user.id]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ce compte Pi est déjà rattaché à un autre compte.', 'duplicate');
    throw e;
  }
  await audit(req, 'auth.pi_link', 'user', req.user.id);
  res.json({ user: publicUser(await fullUser(req.user.id)) });
}));

r.get('/me', requireAuth, asyncH(async (req, res) => res.json({ user: publicUser(await fullUser(req.user.id)) })));

r.patch('/me', requireAuth, asyncH(async (req, res) => {
  const d = z.object({
    full_name: z.string().trim().min(2).max(100).optional(),
    phone: phoneField.optional(),
    email: z.string().trim().toLowerCase().email().nullable().optional(),
  }).parse(req.body);
  try {
    await query(
      `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), email = CASE WHEN $4 THEN $3 ELSE email END WHERE id = $5`,
      [d.full_name ?? null, d.phone ?? null, d.email ?? null, d.email !== undefined, req.user.id]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ce téléphone ou cet e-mail est déjà utilisé.', 'duplicate');
    throw e;
  }
  res.json({ user: publicUser(await fullUser(req.user.id)) });
}));

r.post('/change-password', requireAuth, asyncH(async (req, res) => {
  const d = z.object({ current_password: z.string().max(100).optional(), new_password: passwordField }).parse(req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (rows[0].password_hash) {
    if (!d.current_password || !(await bcrypt.compare(d.current_password, rows[0].password_hash))) throw new HttpError(401, 'Mot de passe actuel incorrect.', 'bad_credentials');
  }
  // token_version++ invalide les anciennes sessions
  const up = await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id', [await bcrypt.hash(d.new_password, 12), req.user.id]);
  await audit(req, 'auth.change_password', 'user', req.user.id);
  const u = await fullUser(up.rows[0].id);
  res.json({ token: signToken(u) });
}));

export default r;
