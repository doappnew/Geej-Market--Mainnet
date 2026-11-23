import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, asyncH, normalizePhone, numericParams } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');
r.use(requireAuth);

const addrSchema = z.object({
  label: z.string().trim().min(1).max(40).default('Domicile'),
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().refine((v) => normalizePhone(v), 'Numéro de téléphone sénégalais invalide.'),
  region_id: z.coerce.number().int().positive(),
  department: z.string().trim().min(2).max(80),
  commune: z.string().trim().min(2).max(80),
  quartier: z.string().trim().min(2).max(80),
  address_line: z.string().trim().min(3).max(250),
  landmark: z.string().trim().max(250).optional().nullable(),
  is_default: z.boolean().optional(),
});

r.get('/addresses', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, r.name AS region_name FROM addresses a JOIN regions r ON r.id=a.region_id WHERE a.user_id=$1 ORDER BY a.is_default DESC, a.id`, [req.user.id]);
  res.json({ addresses: rows });
}));

r.post('/addresses', asyncH(async (req, res) => {
  const d = addrSchema.parse(req.body);
  const count = (await query('SELECT count(*)::int AS n FROM addresses WHERE user_id=$1', [req.user.id])).rows[0].n;
  if (count >= 10) throw new HttpError(422, 'Maximum 10 adresses.', 'limit');
  if (d.is_default) await query('UPDATE addresses SET is_default=FALSE WHERE user_id=$1', [req.user.id]);
  const { rows } = await query(
    `INSERT INTO addresses(user_id,label,full_name,phone,region_id,department,commune,quartier,address_line,landmark,is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [req.user.id, d.label, d.full_name, normalizePhone(d.phone), d.region_id, d.department, d.commune, d.quartier, d.address_line, d.landmark || null, !!d.is_default || count === 0]);
  res.status(201).json({ id: rows[0].id });
}));

r.put('/addresses/:id', asyncH(async (req, res) => {
  const d = addrSchema.parse(req.body);
  if (d.is_default) await query('UPDATE addresses SET is_default=FALSE WHERE user_id=$1', [req.user.id]);
  const up = await query(
    `UPDATE addresses SET label=$1,full_name=$2,phone=$3,region_id=$4,department=$5,commune=$6,quartier=$7,address_line=$8,landmark=$9,is_default=COALESCE($10,is_default)
     WHERE id=$11 AND user_id=$12 RETURNING id`,
    [d.label, d.full_name, normalizePhone(d.phone), d.region_id, d.department, d.commune, d.quartier, d.address_line, d.landmark || null, d.is_default ?? null, req.params.id, req.user.id]);
  if (!up.rowCount) throw new HttpError(404, 'Adresse introuvable.', 'not_found');
  res.json({ ok: true });
}));

r.delete('/addresses/:id', asyncH(async (req, res) => {
  await query('DELETE FROM addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ---- Notifications ----
r.get('/notifications', asyncH(async (req, res) => {
  const { rows } = await query(`SELECT id,type,title,body,order_id,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 50`, [req.user.id]);
  const unread = (await query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT is_read`, [req.user.id])).rows[0].n;
  res.json({ notifications: rows, unread });
}));
r.post('/notifications/read', asyncH(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.coerce.number().int()).max(100).optional() }).parse(req.body || {});
  await query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND ($2::int[] IS NULL OR id = ANY($2::int[]))`, [req.user.id, ids ?? null]);
  res.json({ ok: true });
}));

// ---- Réclamations ----
r.get('/complaints', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, o.order_no FROM complaints c LEFT JOIN orders o ON o.id=c.order_id WHERE c.user_id=$1 ORDER BY c.created_at DESC`, [req.user.id]);
  res.json({ complaints: rows });
}));
r.post('/complaints', asyncH(async (req, res) => {
  const d = z.object({
    order_id: z.coerce.number().int().positive().optional().nullable(),
    subject: z.string().trim().min(3).max(120), message: z.string().trim().min(5).max(2000),
  }).parse(req.body);
  if (d.order_id) {
    const o = await query('SELECT 1 FROM orders WHERE id=$1 AND user_id=$2', [d.order_id, req.user.id]);
    if (!o.rowCount) throw new HttpError(404, 'Commande introuvable.', 'not_found');
  }
  const { rows } = await query(`INSERT INTO complaints(user_id,order_id,subject,message) VALUES ($1,$2,$3,$4) RETURNING id`, [req.user.id, d.order_id || null, d.subject, d.message]);
  await audit(req, 'complaint.create', 'complaint', rows[0].id);
  // Alerte vendeur/admins
  const targets = (await query(
    `SELECT u.id FROM users u WHERE u.role='admin' AND u.is_active
     UNION SELECT s.user_id FROM orders o JOIN sellers s ON s.id=o.seller_id WHERE o.id=$1`, [d.order_id || 0])).rows;
  for (const t of targets) await query(`INSERT INTO notifications(user_id,type,title,body,order_id) VALUES ($1,'complaint_new','Nouvelle réclamation',$2,$3)`, [t.id, d.subject, d.order_id || null]);
  res.status(201).json({ id: rows[0].id });
}));

export default r;
