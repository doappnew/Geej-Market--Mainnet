import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, asyncH, normalizePhone, ORDER_STATUSES, numericParams } from '../util.js';
import { piAmount } from './../lib/money.js';
import { loadReceipt, sameCode } from '../lib/receipt.js';
import { audit, notify } from '../audit.js';
import { orderDetail, cancelOrderTx } from './orders.js';
import { zoneSchema, ZCOLS } from './seller.js';
import { PRODUCT_SELECT } from '../lib/products.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');
r.use(requireRole('admin'));

const page = (q) => { const p = Math.max(1, Number(q.page) || 1); return { p, limit: 30, offset: (p - 1) * 30 }; };
const like = (s) => `%${String(s).replace(/[%_\\]/g, '\\$&')}%`;

r.get('/stats', asyncH(async (_req, res) => {
  const one = async (sql) => (await query(sql)).rows[0];
  const [orders, users, products, money, byStatus, daily] = await Promise.all([
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at::date = current_date)::int AS today FROM orders`),
    one(`SELECT count(*) FILTER (WHERE role='client')::int AS clients, count(*) FILTER (WHERE role='seller')::int AS sellers, count(*) FILTER (WHERE role='admin')::int AS admins, count(*) FILTER (WHERE NOT is_active)::int AS suspended FROM users`),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active AND stock >= min_qty)::int AS available, count(*) FILTER (WHERE stock < min_qty)::int AS out_of_stock FROM products`),
    one(`SELECT COALESCE(sum(COALESCE(final_total,total)) FILTER (WHERE payment_status='paye'),0)::float8 AS paid_revenue, COALESCE(sum(total) FILTER (WHERE status NOT IN ('annulee')),0)::float8 AS gross FROM orders`),
    query(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`),
    query(`SELECT to_char(d,'YYYY-MM-DD') AS day, count(o.id)::int AS orders FROM generate_series(current_date-13,current_date,'1 day') d LEFT JOIN orders o ON o.created_at::date=d GROUP BY d ORDER BY d`),
  ]);
  const complaints = await one(`SELECT count(*) FILTER (WHERE status IN ('ouverte','en_cours'))::int AS open FROM complaints`);
  res.json({ orders, users, products, money, complaints, by_status: byStatus.rows, daily: daily.rows });
}));

// ---- Utilisateurs ----
r.get('/users', asyncH(async (req, res) => {
  const { p, limit, offset } = page(req.query);
  const params = []; const where = [];
  if (req.query.role) { params.push(req.query.role); where.push(`u.role = $${params.length}`); }
  if (req.query.search) { params.push(like(req.query.search)); where.push(`(u.full_name ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.pi_username ILIKE $${params.length})`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await query(`SELECT count(*)::int AS n FROM users u ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT u.id, u.full_name, u.phone, u.email, u.pi_username, u.role, u.is_active, u.created_at FROM users u ${w} ORDER BY u.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ users: rows, total, page: p });
}));
r.patch('/users/:id', asyncH(async (req, res) => {
  const d = z.object({ is_active: z.boolean() }).parse(req.body);
  if (Number(req.params.id) === req.user.id) throw new HttpError(409, 'Vous ne pouvez pas suspendre votre propre compte.', 'self');
  const up = await query(`UPDATE users SET is_active=$1, token_version=token_version+1 WHERE id=$2 RETURNING id`, [d.is_active, req.params.id]);
  if (!up.rowCount) throw new HttpError(404, 'Utilisateur introuvable.', 'not_found');
  await audit(req, d.is_active ? 'user.reactivate' : 'user.suspend', 'user', req.params.id);
  res.json({ ok: true });
}));
r.post('/users/:id/reset-password', asyncH(async (req, res) => {
  const { new_password } = z.object({ new_password: z.string().min(8).max(100) }).parse(req.body);
  const up = await query(`UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2 RETURNING id`, [await bcrypt.hash(new_password, 12), req.params.id]);
  if (!up.rowCount) throw new HttpError(404, 'Utilisateur introuvable.', 'not_found');
  await audit(req, 'user.reset_password', 'user', req.params.id);
  res.json({ ok: true });
}));

// ---- Vendeurs ----
r.get('/sellers', asyncH(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.shop_name, s.city, s.phone, s.is_active, u.id AS user_id, u.email, u.full_name, u.is_active AS user_active,
            (SELECT count(*)::int FROM products WHERE seller_id=s.id) AS products, (SELECT count(*)::int FROM orders WHERE seller_id=s.id) AS orders
     FROM sellers s JOIN users u ON u.id=s.user_id ORDER BY s.id`);
  res.json({ sellers: rows });
}));
r.post('/sellers', asyncH(async (req, res) => {
  const d = z.object({
    full_name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().refine((v) => normalizePhone(v), 'Téléphone invalide.'), password: z.string().min(8).max(100),
    shop_name: z.string().trim().min(2).max(100), city: z.string().trim().max(80).optional(),
  }).parse(req.body);
  try {
    const out = await tx(async (c) => {
      const u = (await c.query(`INSERT INTO users(full_name,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,'seller') RETURNING id`, [d.full_name, d.email, normalizePhone(d.phone), await bcrypt.hash(d.password, 12)])).rows[0];
      const s = (await c.query(`INSERT INTO sellers(user_id,shop_name,phone,city) VALUES ($1,$2,$3,$4) RETURNING id`, [u.id, d.shop_name, normalizePhone(d.phone), d.city || null])).rows[0];
      await audit(req, 'seller.create', 'seller', s.id, { shop_name: d.shop_name }, c);
      return { id: s.id, user_id: u.id };
    });
    res.status(201).json(out);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'E-mail ou téléphone déjà utilisé.', 'duplicate'); throw e; }
}));
r.patch('/sellers/:id', asyncH(async (req, res) => {
  const d = z.object({ is_active: z.boolean().optional(), shop_name: z.string().trim().min(2).max(100).optional() }).parse(req.body);
  const up = await query(`UPDATE sellers SET is_active=COALESCE($1,is_active), shop_name=COALESCE($2,shop_name) WHERE id=$3 RETURNING id`, [d.is_active ?? null, d.shop_name ?? null, req.params.id]);
  if (!up.rowCount) throw new HttpError(404, 'Vendeur introuvable.', 'not_found');
  await audit(req, 'seller.update', 'seller', req.params.id, d);
  res.json({ ok: true });
}));

// ---- Administrateurs ----
r.get('/admins', asyncH(async (_req, res) => {
  const { rows } = await query(`SELECT a.id, a.level, u.id AS user_id, u.full_name, u.email, u.is_active FROM admins a JOIN users u ON u.id=a.user_id ORDER BY a.id`);
  res.json({ admins: rows });
}));
r.post('/admins', asyncH(async (req, res) => {
  const me = (await query('SELECT level FROM admins WHERE user_id=$1', [req.user.id])).rows[0];
  if (me?.level !== 'super_admin') throw new HttpError(403, 'Réservé au super administrateur.', 'forbidden');
  const d = z.object({ full_name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(100) }).parse(req.body);
  try {
    const id = await tx(async (c) => {
      const u = (await c.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES ($1,$2,$3,'admin') RETURNING id`, [d.full_name, d.email, await bcrypt.hash(d.password, 12)])).rows[0];
      await c.query(`INSERT INTO admins(user_id,level) VALUES ($1,'admin')`, [u.id]);
      await audit(req, 'admin.create', 'user', u.id, null, c);
      return u.id;
    });
    res.status(201).json({ id });
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'E-mail déjà utilisé.', 'duplicate'); throw e; }
}));

// ---- Catégories ----
const catSchema = z.object({ name: z.string().trim().min(2).max(60), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/), image_url: z.string().trim().max(500).nullable().optional(), sort_order: z.coerce.number().int().default(0), is_active: z.boolean().default(true) });
r.get('/categories', asyncH(async (_req, res) => res.json({ categories: (await query(`SELECT c.*, (SELECT count(*)::int FROM products WHERE category_id=c.id) AS products FROM categories c ORDER BY sort_order, id`)).rows })));
r.post('/categories', asyncH(async (req, res) => {
  const d = catSchema.parse(req.body);
  try {
    const { rows } = await query(`INSERT INTO categories(name,slug,image_url,sort_order,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [d.name, d.slug, d.image_url || null, d.sort_order, d.is_active]);
    await audit(req, 'category.create', 'category', rows[0].id, d); res.status(201).json({ id: rows[0].id });
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Ce identifiant (slug) existe déjà.', 'duplicate'); throw e; }
}));
r.put('/categories/:id', asyncH(async (req, res) => {
  const d = catSchema.parse(req.body);
  const up = await query(`UPDATE categories SET name=$1,slug=$2,image_url=$3,sort_order=$4,is_active=$5 WHERE id=$6 RETURNING id`, [d.name, d.slug, d.image_url || null, d.sort_order, d.is_active, req.params.id]);
  if (!up.rowCount) throw new HttpError(404, 'Catégorie introuvable.', 'not_found');
  await audit(req, 'category.update', 'category', req.params.id, d); res.json({ ok: true });
}));
r.delete('/categories/:id', asyncH(async (req, res) => {
  const n = (await query('SELECT count(*)::int AS n FROM products WHERE category_id=$1', [req.params.id])).rows[0].n;
  if (n) throw new HttpError(409, `Catégorie utilisée par ${n} produit(s): désactivez-la plutôt.`, 'in_use');
  await query('DELETE FROM categories WHERE id=$1', [req.params.id]);
  await audit(req, 'category.delete', 'category', req.params.id); res.json({ ok: true });
}));

// ---- Produits / stocks ----
r.get('/products', asyncH(async (req, res) => {
  const { p, limit, offset } = page(req.query);
  const params = []; const where = [];
  if (req.query.search) { params.push(like(req.query.search)); where.push(`p.name ILIKE $${params.length}`); }
  if (req.query.seller_id) { params.push(Number(req.query.seller_id)); where.push(`p.seller_id = $${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows } = await query(`${PRODUCT_SELECT} ${w} ORDER BY p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ products: rows, page: p });
}));
r.patch('/products/:id', asyncH(async (req, res) => {
  const d = z.object({ is_active: z.boolean().optional(), is_featured: z.boolean().optional(), stock: z.coerce.number().min(0).optional(), price: piAmount().optional(), promo_price: piAmount().nullable().optional() }).parse(req.body);
  const cur = (await query('SELECT price, promo_price FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  const price = d.price ?? cur.price; const promo = d.promo_price !== undefined ? d.promo_price : cur.promo_price;
  if (promo != null && promo >= price) throw new HttpError(422, 'Le prix promo doit être inférieur au prix normal.', 'bad_promo');
  await query(`UPDATE products SET is_active=COALESCE($2,is_active), is_featured=COALESCE($3,is_featured), stock=COALESCE($4,stock), price=$5, promo_price=$6, updated_at=now() WHERE id=$1`,
    [req.params.id, d.is_active ?? null, d.is_featured ?? null, d.stock ?? null, price, promo]);
  await audit(req, 'product.admin_patch', 'product', req.params.id, d); res.json({ ok: true });
}));
r.delete('/products/:id', asyncH(async (req, res) => {
  await query('DELETE FROM products WHERE id=$1', [req.params.id]);
  await audit(req, 'product.admin_delete', 'product', req.params.id); res.json({ ok: true });
}));

// ---- Commandes ----
r.get('/orders', asyncH(async (req, res) => {
  const { p, limit, offset } = page(req.query);
  const params = []; const where = [];
  if (req.query.status) { params.push(req.query.status); where.push(`o.status = $${params.length}`); }
  if (req.query.search) { params.push(like(req.query.search)); where.push(`(o.order_no ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_phone ILIKE $${params.length})`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows } = await query(
    `SELECT o.id,o.order_no,o.status,o.payment_method,o.payment_status,o.total,o.final_total,o.customer_name,o.customer_phone,o.commune,o.created_at,s.shop_name
     FROM orders o JOIN sellers s ON s.id=o.seller_id ${w} ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ orders: rows, page: p });
}));
r.get('/orders/:id', asyncH(async (req, res) => {
  const o = await orderDetail(req.params.id, {});
  if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
  res.json({ order: o });
}));
r.post('/orders/:id/status', asyncH(async (req, res) => {
  const d = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().min(3).max(300) }).parse(req.body);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (o.status === d.status) throw new HttpError(409, 'Statut identique.', 'same');
    if (o.status === 'annulee') throw new HttpError(409, 'Une commande annulée ne peut pas être rouverte.', 'closed');
    if (d.status === 'annulee') await cancelOrderTx(c, o, req.user.id, d.note);
    else {
      await c.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [d.status, o.id]);
      await c.query('INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)', [o.id, d.status, `[Admin] ${d.note}`, req.user.id]);
      await notify(c, o.user_id, 'order_status', 'Statut de commande mis à jour', o.order_no, o.id);
    }
    await audit(req, 'order.admin_status', 'order', o.id, { from: o.status, to: d.status, note: d.note }, c);
  });
  res.json({ ok: true });
}));
// Enregistre un remboursement effectué hors plateforme (aucun remboursement automatique n'est simulé)
r.post('/orders/:id/refund', asyncH(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(3).max(300) }).parse(req.body);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (o.payment_status !== 'paye') throw new HttpError(409, "Aucun paiement reçu à rembourser.", 'not_paid');
    await c.query(`UPDATE orders SET payment_status='rembourse', updated_at=now() WHERE id=$1`, [o.id]);
    await c.query(`UPDATE payments SET status='rembourse' WHERE order_id=$1 AND status='paye'`, [o.id]);
    await c.query('INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)', [o.id, o.status, `Remboursement enregistré: ${note}`, req.user.id]);
    await notify(c, o.user_id, 'payment_refunded', 'Remboursement enregistré', o.order_no, o.id);
    await audit(req, 'order.refund', 'order', o.id, { note }, c);
  });
  res.json({ ok: true });
}));

// ---- Zones et frais de livraison (tous vendeurs) ----
r.get('/zones', asyncH(async (_req, res) => {
  const { rows } = await query(`SELECT z.*, r.name AS region_name, s.shop_name FROM delivery_zones z JOIN regions r ON r.id=z.region_id JOIN sellers s ON s.id=z.seller_id ORDER BY s.shop_name, r.name, z.commune NULLS FIRST`);
  res.json({ zones: rows });
}));
r.post('/zones', asyncH(async (req, res) => {
  const d = zoneSchema.extend({ seller_id: z.coerce.number().int().positive() }).parse(req.body);
  try {
    const { rows } = await query(`INSERT INTO delivery_zones(seller_id,${ZCOLS.join(',')}) VALUES ($1,${ZCOLS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`, [d.seller_id, ...ZCOLS.map((k) => d[k] ?? null)]);
    await audit(req, 'zone.admin_create', 'zone', rows[0].id, d); res.status(201).json({ id: rows[0].id });
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Zone déjà existante.', 'duplicate'); if (e.code === '23503') throw new HttpError(404, 'Vendeur ou région introuvable.', 'not_found'); throw e; }
}));
r.put('/zones/:id', asyncH(async (req, res) => {
  const d = zoneSchema.parse(req.body);
  const up = await query(`UPDATE delivery_zones SET ${ZCOLS.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING id`, [req.params.id, ...ZCOLS.map((k) => d[k] ?? null)]);
  if (!up.rowCount) throw new HttpError(404, 'Zone introuvable.', 'not_found');
  await audit(req, 'zone.admin_update', 'zone', req.params.id, d); res.json({ ok: true });
}));
r.delete('/zones/:id', asyncH(async (req, res) => { await query('DELETE FROM delivery_zones WHERE id=$1', [req.params.id]); await audit(req, 'zone.admin_delete', 'zone', req.params.id); res.json({ ok: true }); }));

// ---- Réclamations ----
r.get('/complaints', asyncH(async (_req, res) => {
  const { rows } = await query(`SELECT c.*, u.full_name, u.phone, o.order_no FROM complaints c JOIN users u ON u.id=c.user_id LEFT JOIN orders o ON o.id=c.order_id ORDER BY (c.status IN ('ouverte','en_cours')) DESC, c.created_at DESC LIMIT 200`);
  res.json({ complaints: rows });
}));
r.patch('/complaints/:id', asyncH(async (req, res) => {
  const d = z.object({ status: z.enum(['ouverte', 'en_cours', 'resolue', 'rejetee']), response: z.string().trim().max(2000).optional() }).parse(req.body);
  const up = await query(`UPDATE complaints SET status=$1, response=COALESCE($2,response), updated_at=now() WHERE id=$3 RETURNING user_id, subject`, [d.status, d.response ?? null, req.params.id]);
  if (!up.rowCount) throw new HttpError(404, 'Réclamation introuvable.', 'not_found');
  await notify(null, up.rows[0].user_id, 'complaint_update', 'Votre réclamation a été mise à jour', up.rows[0].subject);
  await audit(req, 'complaint.update', 'complaint', req.params.id, { status: d.status }); res.json({ ok: true });
}));

// Vérification d'un reçu (tous vendeurs)
r.post('/receipts/verify', asyncH(async (req, res) => {
  const d = z.object({ order_no: z.string().trim().min(8).max(30), code: z.string().trim().min(6).max(20) }).parse(req.body);
  const rc = await loadReceipt('o.order_no=$1', [d.order_no.toUpperCase()]);
  if (!rc || !rc.paid || !sameCode(d.code, rc.code)) throw new HttpError(404, 'Reçu invalide ou introuvable.', 'receipt_invalid');
  const { code, txid, ...safe } = rc;
  res.json({ valid: true, receipt: safe });
}));

// ---- Paramètres (contacts du support) ----
const SETTING_KEYS = ['support_phone', 'support_whatsapp'];
r.get('/settings', asyncH(async (_req, res) => {
  const { rows } = await query('SELECT key, value FROM settings'); res.json({ settings: Object.fromEntries(rows.map((x) => [x.key, x.value])) });
}));
r.put('/settings', asyncH(async (req, res) => {
  const d = z.object({
    support_phone: z.string().trim().max(30).optional(), support_whatsapp: z.string().trim().max(30).optional(),
  }).parse(req.body);
  for (const k of SETTING_KEYS) if (d[k] !== undefined) {
    if (d[k] === '') await query('DELETE FROM settings WHERE key=$1', [k]);
    else await query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, d[k]]);
  }
  await audit(req, 'settings.update', 'settings', null, d); res.json({ ok: true });
}));

// ---- Journal d'audit ----
r.get('/audit', asyncH(async (req, res) => {
  const { p, limit, offset } = page(req.query);
  const params = []; let w = '';
  if (req.query.action) { params.push(like(req.query.action)); w = `WHERE a.action ILIKE $1`; }
  const { rows } = await query(`SELECT a.id,a.action,a.entity,a.entity_id,a.details,a.ip,a.created_at,u.full_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ${w} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ logs: rows, page: p });
}));

export default r;
