import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { itemsSchema, mergeItems } from '../lib/products.js';
import { planOrders } from '../lib/checkout.js';
import { HttpError, asyncH, normalizePhone, DELIVERY_MODES, isPickup, numericParams, pi7 } from '../util.js';
import { audit, notify } from '../audit.js';
import { loadReceipt } from '../lib/receipt.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');

const modeField = z.enum(DELIVERY_MODES);

// Devis (public): frais et zones, sans créer de commande
r.post('/quote', asyncH(async (req, res) => {
  const d = z.object({
    items: itemsSchema, region_id: z.coerce.number().int().positive().optional(),
    commune: z.string().trim().max(80).optional(), mode: modeField.optional(),
  }).parse(req.body);
  const plan = await planOrders({ query }, mergeItems(d.items), { regionId: d.region_id, commune: d.commune, mode: d.mode }, { strict: false });
  const sellers = plan.sellers.map(({ zone, lines, ...s }) => ({ ...s, lines, zone: zone && { id: zone.id, pickup_available: zone.pickup_available, home_delivery: zone.home_delivery, pickup_address: zone.pickup_address, conditions: zone.conditions } }));
  const subtotal = pi7(sellers.reduce((a, s) => a + s.subtotal, 0));
  const delivery_fee = pi7(sellers.reduce((a, s) => a + (s.served ? s.fee : 0), 0));
  res.json({
    sellers, problems: plan.problems, subtotal, delivery_fee, total: pi7(subtotal + delivery_fee),
    fee_known: !!d.region_id && sellers.length > 0 && sellers.every((s) => s.served),
    can_order: plan.problems.length === 0 && !!d.region_id && sellers.length > 0 && sellers.every((s) => s.served),
  });
}));

const createSchema = z.object({
  items: itemsSchema,
  customer: z.object({
    full_name: z.string().trim().min(2).max(100),
    phone: z.string().trim().refine((v) => normalizePhone(v), 'Numéro de téléphone sénégalais invalide.'),
    email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
    pi_username: z.string().trim().max(60).optional().or(z.literal('')),
  }),
  address: z.object({
    region_id: z.coerce.number().int().positive(),
    department: z.string().trim().min(2).max(80),
    commune: z.string().trim().min(2).max(80),
    quartier: z.string().trim().min(2).max(80),
    address_line: z.string().trim().min(3).max(250),
    landmark: z.string().trim().max(250).optional().or(z.literal('')),
    lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
  }),
  delivery_mode: modeField,
  comment: z.string().trim().max(500).optional().or(z.literal('')),
  consent_data: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter le traitement de vos données.' }) }),
  save_address: z.boolean().optional(),
});

r.post('/', requireAuth, asyncH(async (req, res) => {
  const d = createSchema.parse(req.body);
  const items = mergeItems(d.items);
  const phone = normalizePhone(d.customer.phone);
  const created = await tx(async (c) => {
    const plan = await planOrders(c, items, { regionId: d.address.region_id, commune: d.address.commune, mode: d.delivery_mode }, { lock: true });
    const blocked = plan.sellers.find((s) => !s.served);
    if (blocked) throw new HttpError(422, blocked.reason || "Zone non desservie.", 'zone_not_served');
    const out = [];
    for (const g of plan.sellers) {
      const num = (await c.query(`SELECT nextval('order_number_seq') AS n`)).rows[0].n;
      const orderNo = `GJM-${new Date().getFullYear()}-${String(num).padStart(6, '0')}`;
      // Toute commande est payée en Pi: elle reste en attente de paiement (invisible du vendeur) jusqu'à confirmation du paiement.
      const status = 'en_attente_paiement';
      const o = (await c.query(
        `INSERT INTO orders(order_no,user_id,seller_id,status,payment_method,payment_status,customer_name,customer_phone,customer_email,pi_username,
           region_id,department,commune,quartier,address_line,landmark,lat,lng,delivery_mode,comment,subtotal,delivery_fee,total,consent_data)
         VALUES ($1,$2,$3,$4,'pi','non_paye',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,TRUE) RETURNING id, order_no, total, status`,
        [orderNo, req.user.id, g.seller_id, status, d.customer.full_name, phone, d.customer.email || null, d.customer.pi_username || req.user.pi_username || null,
         d.address.region_id, d.address.department, d.address.commune, d.address.quartier, d.address.address_line, d.address.landmark || null, d.address.lat ?? null, d.address.lng ?? null,
         d.delivery_mode, d.comment || null, g.subtotal, g.fee, g.total])).rows[0];
      for (const l of g.lines) {
        await c.query(
          `INSERT INTO order_items(order_id,product_id,product_name,unit,unit_price,quantity,line_total,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [o.id, l.product_id, l.product_name, l.unit, l.unit_price, l.quantity, l.line_total, l.image_url]);
        await c.query(`UPDATE products SET stock = stock - $1, orders_count = orders_count + 1, updated_at = now() WHERE id = $2`, [l.quantity, l.product_id]);
      }
      await c.query(`INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,$2,$3,$4)`, [o.id, status, 'Commande enregistrée', req.user.id]);
      await c.query(`INSERT INTO deliveries(order_id,mode,zone_id,fee,eta_text) VALUES ($1,$2,$3,$4,$5)`, [o.id, d.delivery_mode, g.zone.id, g.fee, g.eta_text]);
      await c.query(`INSERT INTO payments(order_id,method,amount_pi,status) VALUES ($1,'pi',$2,'en_attente')`, [o.id, g.total]);
      await notify(c, req.user.id, 'order_created', 'Commande enregistrée', `Votre commande ${o.order_no} a bien été enregistrée.`, o.id);
      await audit(req, 'order.create', 'order', o.id, { order_no: o.order_no, total: g.total, currency: 'PI' }, c);
      out.push(o);
    }
    await c.query(`DELETE FROM cart_items WHERE cart_id=(SELECT id FROM carts WHERE user_id=$1) AND product_id = ANY($2::int[])`, [req.user.id, items.map((i) => i.product_id)]);
    if (d.save_address) {
      await c.query(
        `INSERT INTO addresses(user_id,label,full_name,phone,region_id,department,commune,quartier,address_line,landmark,is_default)
         VALUES ($1,'Domicile',$2,$3,$4,$5,$6,$7,$8,$9, NOT EXISTS(SELECT 1 FROM addresses WHERE user_id=$1))`,
        [req.user.id, d.customer.full_name, phone, d.address.region_id, d.address.department, d.address.commune, d.address.quartier, d.address.address_line, d.address.landmark || null]);
    }
    return out;
  });
  res.status(201).json({ orders: created });
}));

// ---- Consultation côté client ----
r.get('/', requireAuth, asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.final_total, o.delivery_mode, o.created_at, s.shop_name,
            (SELECT count(*)::int FROM order_items WHERE order_id = o.id) AS item_count,
            (SELECT json_agg(x.image_url) FROM (SELECT image_url FROM order_items WHERE order_id=o.id AND image_url IS NOT NULL ORDER BY id LIMIT 3) x) AS images
     FROM orders o JOIN sellers s ON s.id = o.seller_id WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.user.id]);
  res.json({ orders: rows });
}));

export async function orderDetail(orderId, scope) {
  const { rows } = await query(
    `SELECT o.*, r.name AS region_name, s.shop_name, s.phone AS seller_phone, s.whatsapp AS seller_whatsapp,
            d.eta_text, d.driver_name, d.driver_phone, d.delivered_at
     FROM orders o JOIN regions r ON r.id = o.region_id JOIN sellers s ON s.id = o.seller_id LEFT JOIN deliveries d ON d.order_id = o.id
     WHERE o.id = $1 ${scope.sql || ''}`, [orderId, ...(scope.params || [])]);
  const o = rows[0];
  if (!o) return null;
  o.items = (await query(`SELECT id, product_id, product_name, unit, unit_price, quantity, line_total, image_url FROM order_items WHERE order_id=$1 ORDER BY id`, [orderId])).rows;
  o.history = (await query(
    `SELECT h.status, h.note, h.created_at, u.full_name AS by_name FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id=$1 ORDER BY h.id`, [orderId])).rows;
  o.payments = (await query(`SELECT id, method, amount_pi, status, created_at, paid_at FROM payments WHERE order_id=$1 ORDER BY id`, [orderId])).rows;
  return o;
}

// Reçu de paiement du client (uniquement si la commande est payée)
r.get('/:id/receipt', requireAuth, asyncH(async (req, res) => {
  const rc = await loadReceipt('o.id=$1 AND o.user_id=$2', [req.params.id, req.user.id]);
  if (!rc) throw new HttpError(404, 'Commande introuvable.', 'not_found');
  if (!rc.paid) throw new HttpError(409, "Aucun paiement confirmé: le reçu n'est pas encore disponible.", 'not_paid');
  res.json({ receipt: rc });
}));

r.get('/:id', requireAuth, asyncH(async (req, res) => {
  const o = await orderDetail(req.params.id, { sql: 'AND o.user_id = $2', params: [req.user.id] });
  if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
  res.json({ order: o });
}));

// Annulation par le client (uniquement tant que la commande n'est pas confirmée et qu'aucun paiement n'a été reçu)
r.post('/:id/cancel', requireAuth, asyncH(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body || {});
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (!['en_attente_paiement', 'nouvelle', 'en_attente_confirmation'].includes(o.status)) throw new HttpError(409, "Cette commande ne peut plus être annulée en ligne. Contactez le service client.", 'not_cancellable');
    if (o.payment_status !== 'non_paye') throw new HttpError(409, "Un paiement est en cours ou reçu: contactez le service client pour l'annulation et le remboursement.", 'paid');
    await cancelOrderTx(c, o, req.user.id, reason || 'Annulée par le client');
    const su = (await c.query('SELECT user_id FROM sellers WHERE id=$1', [o.seller_id])).rows[0];
    await notify(c, su.user_id, 'order_cancelled', 'Commande annulée', `${o.order_no} annulée par le client.`, o.id);
    await audit(req, 'order.cancel_by_client', 'order', o.id, { reason }, c);
  });
  res.json({ ok: true });
}));

// Remet le stock en rayon et marque la commande annulée (appelé dans une transaction)
export async function cancelOrderTx(c, order, byUserId, note) {
  const items = (await c.query('SELECT product_id, quantity FROM order_items WHERE order_id=$1', [order.id])).rows;
  for (const it of items) if (it.product_id) await c.query('UPDATE products SET stock = stock + $1, orders_count = GREATEST(orders_count - 1, 0) WHERE id=$2', [it.quantity, it.product_id]);
  await c.query(`UPDATE orders SET status='annulee', updated_at=now() WHERE id=$1`, [order.id]);
  await c.query(`UPDATE payments SET status = CASE WHEN status='paye' THEN status ELSE 'echoue' END WHERE order_id=$1`, [order.id]);
  await c.query(`INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,'annulee',$2,$3)`, [order.id, note, byUserId]);
  await notify(c, order.user_id, 'order_status', 'Commande annulée', `${order.order_no}: ${note}`, order.id);
}

export default r;
