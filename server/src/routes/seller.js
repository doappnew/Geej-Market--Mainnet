import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, asyncH, normalizePhone, SELLER_TRANSITIONS, ORDER_STATUSES, numericParams, pi7 } from '../util.js';
import { piAmount } from '../lib/money.js';
import rateLimit from 'express-rate-limit';
import { loadReceipt, sameCode } from '../lib/receipt.js';
import { audit, notify } from '../audit.js';
import { saveImage } from '../storage.js';
import { orderDetail, cancelOrderTx } from './orders.js';
import { PRODUCT_SELECT } from '../lib/products.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');
r.use(requireRole('seller'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 6 } });

const STATUS_LABEL = {
  confirmee: 'Votre commande est confirmée', en_attente_confirmation: 'Votre commande est en attente de confirmation',
  en_preparation: 'Votre commande est en préparation', prete: 'Votre commande est prête', en_livraison: 'Votre commande est en cours de livraison',
  livree: 'Votre commande a été livrée', annulee: 'Votre commande a été annulée',
};

// ---- Tableau de bord ----
r.get('/dashboard', asyncH(async (req, res) => {
  const sid = req.user.seller_id;
  const counts = (await query(`SELECT status, count(*)::int AS n FROM orders WHERE seller_id=$1 AND status <> 'en_attente_paiement' GROUP BY status`, [sid])).rows;
  const by = Object.fromEntries(counts.map((x) => [x.status, x.n]));
  const prod = (await query(
    `SELECT count(*) FILTER (WHERE is_active AND stock >= min_qty)::int AS available,
            count(*) FILTER (WHERE is_active AND stock < min_qty)::int AS out_of_stock, count(*)::int AS total
     FROM products WHERE seller_id=$1`, [sid])).rows[0];
  const revenue = (await query(`SELECT COALESCE(sum(COALESCE(final_total,total)),0)::float8 AS v FROM orders WHERE seller_id=$1 AND payment_status='paye'`, [sid])).rows[0].v;
  const top = (await query(
    `SELECT product_name, round(sum(quantity)::numeric,2) AS qty, sum(line_total)::float8 AS amount FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.seller_id=$1 AND o.status <> 'annulee' GROUP BY product_name ORDER BY sum(line_total) DESC LIMIT 5`, [sid])).rows;
  const last7 = (await query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(count(o.id),0)::int AS orders
     FROM generate_series(current_date - 6, current_date, '1 day') d LEFT JOIN orders o ON o.seller_id=$1 AND o.created_at::date = d AND o.status <> 'annulee'
     GROUP BY d ORDER BY d`, [sid])).rows;
  res.json({ orders: by, products: prod, revenue_paid: revenue, top_products: top, last7 });
}));

// ---- Commandes ----
r.get('/orders', asyncH(async (req, res) => {
  const { status } = z.object({ status: z.enum(ORDER_STATUSES).optional() }).parse(req.query);
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.final_total, o.customer_name, o.customer_phone, o.commune, o.delivery_mode, o.created_at,
            (SELECT count(*)::int FROM order_items WHERE order_id=o.id) AS item_count
     FROM orders o WHERE o.seller_id=$1 AND o.status <> 'en_attente_paiement' AND ($2::text IS NULL OR o.status=$2) ORDER BY o.created_at DESC LIMIT 200`,
    [req.user.seller_id, status ?? null]);
  res.json({ orders: rows });
}));

r.get('/orders/:id', asyncH(async (req, res) => {
  const o = await orderDetail(req.params.id, { sql: 'AND o.seller_id = $2', params: [req.user.seller_id] });
  if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
  res.json({ order: o });
}));

async function changeStatus(req, orderId, next, note, extra = {}) {
  return tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [orderId, req.user.seller_id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (o.status === 'en_attente_paiement') throw new HttpError(409, "En attente du paiement du client.", 'awaiting_payment');
    if (!SELLER_TRANSITIONS[o.status]?.includes(next)) throw new HttpError(409, `Passage « ${o.status} » → « ${next} » impossible.`, 'bad_transition');
    if (next === 'annulee') {
      await cancelOrderTx(c, o, req.user.id, note || 'Refusée par le vendeur');
      await c.query('UPDATE orders SET reject_reason=$1 WHERE id=$2', [note || null, o.id]);
      if (o.payment_status === 'paye') {
        // Le paiement Pi a déjà été reçu: aucun remboursement n'est simulé, l'administrateur doit le traiter puis l'enregistrer.
        await c.query('INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)', [o.id, 'annulee', 'Paiement reçu: remboursement à effectuer par l’administrateur', req.user.id]);
        for (const ad of (await c.query(`SELECT id FROM users WHERE role='admin' AND is_active`)).rows) {
          await notify(c, ad.id, 'refund_due', 'Remboursement à effectuer', `${o.order_no} refusée par le vendeur après paiement.`, o.id);
        }
        await notify(c, o.user_id, 'refund_pending', 'Remboursement en préparation', `${o.order_no}: votre paiement en Pi sera remboursé.`, o.id);
      }
    } else {
      await c.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [next, o.id]);
      await c.query('INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)', [o.id, next, note || null, req.user.id]);
      await notify(c, o.user_id, 'order_status', STATUS_LABEL[next] || 'Statut mis à jour', o.order_no, o.id);
      if (next === 'livree') await c.query('UPDATE deliveries SET delivered_at=now() WHERE order_id=$1', [o.id]);
    }
    if (extra.driver_name !== undefined || extra.driver_phone !== undefined) {
      await c.query('UPDATE deliveries SET driver_name=COALESCE($1,driver_name), driver_phone=COALESCE($2,driver_phone) WHERE order_id=$3', [extra.driver_name ?? null, extra.driver_phone ?? null, o.id]);
    }
    await audit(req, 'order.status', 'order', o.id, { from: o.status, to: next, note }, c);
  });
}

r.post('/orders/:id/accept', asyncH(async (req, res) => { await changeStatus(req, req.params.id, 'confirmee', 'Commande acceptée'); res.json({ ok: true }); }));
r.post('/orders/:id/reject', asyncH(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Motif obligatoire.').max(300) }).parse(req.body);
  await changeStatus(req, req.params.id, 'annulee', reason); res.json({ ok: true });
}));
r.post('/orders/:id/status', asyncH(async (req, res) => {
  const d = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(300).optional(), driver_name: z.string().trim().max(100).optional(), driver_phone: z.string().trim().max(30).optional() }).parse(req.body);
  if (d.status === 'annulee' && !d.note) throw new HttpError(422, "Motif d'annulation obligatoire.", 'reason_required');
  await changeStatus(req, req.params.id, d.status, d.note, { driver_name: d.driver_name, driver_phone: d.driver_phone ? normalizePhone(d.driver_phone) : undefined });
  res.json({ ok: true });
}));

// Montant final après pesée / frais de livraison réels. Interdit si un paiement Pi est déjà engagé.
r.patch('/orders/:id/amounts', asyncH(async (req, res) => {
  const d = z.object({ final_total: piAmount().optional(), delivery_fee: piAmount().optional() }).parse(req.body);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [req.params.id, req.user.seller_id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (['livree', 'annulee'].includes(o.status)) throw new HttpError(409, 'Commande clôturée.', 'closed');
    if (o.payment_status !== 'non_paye') throw new HttpError(409, "Un paiement Pi est engagé ou reçu: le montant ne peut plus être modifié.", 'locked');
    const fee = d.delivery_fee ?? o.delivery_fee;
    const final = d.final_total ?? o.final_total;
    await c.query('UPDATE orders SET delivery_fee=$1, final_total=$2, total=$3, updated_at=now() WHERE id=$4', [fee, final, pi7(Number(o.subtotal) + fee), o.id]);
    await c.query('UPDATE deliveries SET fee=$1 WHERE order_id=$2', [fee, o.id]);
    await c.query(`UPDATE payments SET amount_pi=$1 WHERE order_id=$2 AND status IN ('en_attente','echoue')`, [final ?? pi7(Number(o.subtotal) + fee), o.id]);
    await c.query('INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)', [o.id, o.status, `Montants mis à jour (final: ${final ?? '—'} π, livraison: ${fee} π)`, req.user.id]);
    await notify(c, o.user_id, 'order_amount', 'Montant de la commande mis à jour', o.order_no, o.id);
    await audit(req, 'order.amounts', 'order', o.id, { final_total: final, delivery_fee: fee }, c);
  });
  res.json({ ok: true });
}));



// Vérification d'un reçu présenté à la livraison (numéro de commande + code de contrôle du reçu)
r.post('/receipts/verify', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }), asyncH(async (req, res) => {
  const d = z.object({ order_no: z.string().trim().min(8).max(30), code: z.string().trim().min(6).max(20) }).parse(req.body);
  const rc = await loadReceipt('o.order_no=$1 AND ($2::int IS NULL OR o.seller_id=$2)', [d.order_no.toUpperCase(), req.user.seller_id]);
  if (!rc || !rc.paid || !sameCode(d.code, rc.code)) throw new HttpError(404, 'Reçu invalide ou introuvable.', 'receipt_invalid');
  const { code, txid, ...safe } = rc;
  res.json({ valid: true, receipt: safe });
}));

// ---- Produits ----
const productSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(''),
  price: piAmount(),
  promo_price: piAmount().nullable().optional(),
  unit: z.string().trim().min(1).max(30).default('kg'),
  unit_detail: z.string().trim().max(40).nullable().optional(),
  qty_step: z.coerce.number().positive().max(1000).default(1),
  min_qty: z.coerce.number().positive().max(1000).default(1),
  stock: z.coerce.number().min(0).max(1000000),
  condition: z.enum(['frais', 'congelé', 'fumé', 'séché', 'salé', 'autre']).default('frais'),
  storage_info: z.string().trim().max(200).nullable().optional(),
  available_from: z.string().date().nullable().optional(),
  prepared_on: z.string().date().nullable().optional(),
  traceability: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
}).refine((d) => d.promo_price == null || d.promo_price < d.price, { message: 'Le prix promo doit être inférieur au prix normal.', path: ['promo_price'] });

r.get('/products', asyncH(async (req, res) => {
  const { rows } = await query(`${PRODUCT_SELECT} WHERE p.seller_id = $1 ORDER BY p.created_at DESC`, [req.user.seller_id]);
  res.json({ products: rows });
}));

const COLS = ['category_id', 'name', 'description', 'price', 'promo_price', 'unit', 'unit_detail', 'qty_step', 'min_qty', 'stock', 'condition', 'storage_info', 'available_from', 'prepared_on', 'traceability', 'is_active', 'is_featured'];

r.post('/products', asyncH(async (req, res) => {
  const d = productSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO products(seller_id,${COLS.join(',')}) VALUES ($1,${COLS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`,
    [req.user.seller_id, ...COLS.map((k) => d[k] ?? null)]);
  await audit(req, 'product.create', 'product', rows[0].id, { name: d.name });
  res.status(201).json({ id: rows[0].id });
}));

r.put('/products/:id', asyncH(async (req, res) => {
  const d = productSchema.parse(req.body);
  const up = await query(
    `UPDATE products SET ${COLS.map((k, i) => `${k}=$${i + 3}`).join(',')}, updated_at=now() WHERE id=$1 AND seller_id=$2 RETURNING id`,
    [req.params.id, req.user.seller_id, ...COLS.map((k) => d[k] ?? null)]);
  if (!up.rowCount) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  await audit(req, 'product.update', 'product', req.params.id, { price: d.price, stock: d.stock, active: d.is_active });
  res.json({ ok: true });
}));

// Mises à jour rapides: stock / activation / prix
r.patch('/products/:id', asyncH(async (req, res) => {
  const d = z.object({ stock: z.coerce.number().min(0).max(1000000).optional(), is_active: z.boolean().optional(), price: piAmount().optional(), promo_price: piAmount().nullable().optional() }).parse(req.body);
  const cur = (await query('SELECT price, promo_price FROM products WHERE id=$1 AND seller_id=$2', [req.params.id, req.user.seller_id])).rows[0];
  if (!cur) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  const price = d.price ?? cur.price; const promo = d.promo_price !== undefined ? d.promo_price : cur.promo_price;
  if (promo != null && promo >= price) throw new HttpError(422, 'Le prix promo doit être inférieur au prix normal.', 'bad_promo');
  await query(
    `UPDATE products SET stock=COALESCE($3,stock), is_active=COALESCE($4,is_active), price=$5, promo_price=$6, updated_at=now() WHERE id=$1 AND seller_id=$2`,
    [req.params.id, req.user.seller_id, d.stock ?? null, d.is_active ?? null, price, promo]);
  await audit(req, 'product.patch', 'product', req.params.id, d);
  res.json({ ok: true });
}));

r.delete('/products/:id', asyncH(async (req, res) => {
  const del = await query('DELETE FROM products WHERE id=$1 AND seller_id=$2 RETURNING id', [req.params.id, req.user.seller_id]);
  if (!del.rowCount) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  await audit(req, 'product.delete', 'product', req.params.id);
  res.json({ ok: true });
}));

r.post('/products/:id/images', upload.array('images', 6), asyncH(async (req, res) => {
  const own = await query('SELECT 1 FROM products WHERE id=$1 AND seller_id=$2', [req.params.id, req.user.seller_id]);
  if (!own.rowCount) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  if (!req.files?.length) throw new HttpError(400, 'Aucune image reçue.', 'no_file');
  const n = (await query('SELECT count(*)::int AS n FROM product_images WHERE product_id=$1', [req.params.id])).rows[0].n;
  if (n + req.files.length > 10) throw new HttpError(422, 'Maximum 10 photos par produit.', 'limit');
  const urls = [];
  for (const f of req.files) {
    const url = await saveImage(f.buffer);
    await query('INSERT INTO product_images(product_id,url,sort_order) VALUES ($1,$2,$3)', [req.params.id, url, n + urls.length]);
    urls.push(url);
  }
  await audit(req, 'product.images_add', 'product', req.params.id, { count: urls.length });
  res.status(201).json({ urls });
}));

r.delete('/products/:id/images/:imageId', asyncH(async (req, res) => {
  await query(`DELETE FROM product_images WHERE id=$1 AND product_id=$2 AND product_id IN (SELECT id FROM products WHERE seller_id=$3)`, [req.params.imageId, req.params.id, req.user.seller_id]);
  res.json({ ok: true });
}));
r.get('/products/:id/images', asyncH(async (req, res) => {
  const { rows } = await query(`SELECT i.id, i.url, i.sort_order FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.id=$1 AND p.seller_id=$2 ORDER BY i.sort_order, i.id`, [req.params.id, req.user.seller_id]);
  res.json({ images: rows });
}));

// ---- Zones de livraison ----
const zoneSchema = z.object({
  region_id: z.coerce.number().int().positive(),
  commune: z.string().trim().max(80).nullable().optional().transform((v) => v || null),
  fee: piAmount(),
  eta_text: z.string().trim().min(1).max(60).default('24 h'),
  min_order: piAmount().default(0),
  conditions: z.string().trim().max(500).nullable().optional(),
  home_delivery: z.boolean().default(true),
  pickup_available: z.boolean().default(false),
  pickup_address: z.string().trim().max(250).nullable().optional(),
  is_active: z.boolean().default(true),
});
const ZCOLS = ['region_id', 'commune', 'fee', 'eta_text', 'min_order', 'conditions', 'home_delivery', 'pickup_available', 'pickup_address', 'is_active'];

r.get('/zones', asyncH(async (req, res) => {
  const { rows } = await query(`SELECT z.*, r.name AS region_name FROM delivery_zones z JOIN regions r ON r.id=z.region_id WHERE z.seller_id=$1 ORDER BY r.name, z.commune NULLS FIRST`, [req.user.seller_id]);
  res.json({ zones: rows });
}));
const dupGuard = (e) => { if (e.code === '23505') throw new HttpError(409, 'Une zone existe déjà pour cette région/commune.', 'duplicate'); throw e; };
r.post('/zones', asyncH(async (req, res) => {
  const d = zoneSchema.parse(req.body);
  try {
    const { rows } = await query(`INSERT INTO delivery_zones(seller_id,${ZCOLS.join(',')}) VALUES ($1,${ZCOLS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`, [req.user.seller_id, ...ZCOLS.map((k) => d[k] ?? null)]);
    await audit(req, 'zone.create', 'zone', rows[0].id, d);
    res.status(201).json({ id: rows[0].id });
  } catch (e) { dupGuard(e); }
}));
r.put('/zones/:id', asyncH(async (req, res) => {
  const d = zoneSchema.parse(req.body);
  try {
    const up = await query(`UPDATE delivery_zones SET ${ZCOLS.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE id=$1 AND seller_id=$2 RETURNING id`, [req.params.id, req.user.seller_id, ...ZCOLS.map((k) => d[k] ?? null)]);
    if (!up.rowCount) throw new HttpError(404, 'Zone introuvable.', 'not_found');
    await audit(req, 'zone.update', 'zone', req.params.id, d);
    res.json({ ok: true });
  } catch (e) { dupGuard(e); }
}));
r.delete('/zones/:id', asyncH(async (req, res) => {
  await query('DELETE FROM delivery_zones WHERE id=$1 AND seller_id=$2', [req.params.id, req.user.seller_id]);
  await audit(req, 'zone.delete', 'zone', req.params.id);
  res.json({ ok: true });
}));

// ---- Profil boutique ----
r.get('/profile', asyncH(async (req, res) => res.json({ seller: (await query('SELECT id, shop_name, description, phone, whatsapp, city FROM sellers WHERE id=$1', [req.user.seller_id])).rows[0] })));
r.put('/profile', asyncH(async (req, res) => {
  const d = z.object({ shop_name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).nullable().optional(), city: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().refine((v) => normalizePhone(v), 'Téléphone invalide.'), whatsapp: z.string().trim().max(20).nullable().optional() }).parse(req.body);
  await query('UPDATE sellers SET shop_name=$1, description=$2, city=$3, phone=$4, whatsapp=$5 WHERE id=$6',
    [d.shop_name, d.description || null, d.city || null, normalizePhone(d.phone), d.whatsapp ? '221' + normalizePhone(d.whatsapp) : null, req.user.seller_id]);
  res.json({ ok: true });
}));

// Notifications vendeur
r.get('/complaints', asyncH(async (req, res) => {
  const { rows } = await query(`SELECT c.id, c.subject, c.message, c.status, c.created_at, o.order_no FROM complaints c JOIN orders o ON o.id=c.order_id WHERE o.seller_id=$1 ORDER BY c.created_at DESC LIMIT 100`, [req.user.seller_id]);
  res.json({ complaints: rows });
}));

export { zoneSchema, ZCOLS, productSchema, COLS };
export default r;
