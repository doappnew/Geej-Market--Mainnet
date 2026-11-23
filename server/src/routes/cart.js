import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { PRODUCT_SELECT, PUBLIC_WHERE, checkQty, itemsSchema, mergeItems } from '../lib/products.js';
import { HttpError, asyncH, numericParams, pi7 } from '../util.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');
r.use(requireAuth);

async function readCart(userId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT ci.quantity, x.* FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
     JOIN LATERAL (${PRODUCT_SELECT} WHERE p.id = ci.product_id AND ${PUBLIC_WHERE}) x ON TRUE
     WHERE c.user_id = $1 ORDER BY ci.id`, [userId]);
  const items = rows.map(({ quantity, ...product }) => ({
    product_id: product.id, quantity, product, line_total: pi7(product.effective_price * quantity),
  }));
  return { items, subtotal: items.reduce((s, i) => s + i.line_total, 0) };
}

const ensureCart = async (client, userId) =>
  (await client.query(`INSERT INTO carts(user_id) VALUES ($1) ON CONFLICT(user_id) DO UPDATE SET updated_at = now() RETURNING id`, [userId])).rows[0].id;

// Valide, ramène au stock disponible (arrondi au pas) et retourne la quantité retenue
async function setItem(client, cartId, productId, quantity) {
  if (quantity <= 0) { await client.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cartId, productId]); return { removed: true }; }
  const { rows } = await client.query(`SELECT p.* FROM products p JOIN sellers s ON s.id=p.seller_id JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND ${PUBLIC_WHERE}`, [productId]);
  const p = rows[0];
  if (!p) throw new HttpError(404, 'Produit introuvable ou indisponible.', 'not_found');
  const step = Number(p.qty_step);
  let q = quantity, clamped = false;
  const maxQ = Math.floor(Number(p.stock) / step + 1e-9) * step;
  if (q > maxQ) { q = maxQ; clamped = true; }
  if (q < Number(p.min_qty) - 1e-9) throw new HttpError(422, `${p.name}: stock insuffisant pour la quantité minimale.`, 'out_of_stock');
  const err = checkQty(p, +q.toFixed(3));
  if (err) throw new HttpError(422, `${p.name}: ${err}`, 'bad_quantity');
  q = +q.toFixed(3);
  await client.query(
    `INSERT INTO cart_items(cart_id, product_id, quantity) VALUES ($1,$2,$3) ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [cartId, productId, q]);
  return { quantity: q, clamped };
}

r.get('/', asyncH(async (req, res) => res.json(await readCart(req.user.id))));

r.put('/items', asyncH(async (req, res) => {
  const d = z.object({ product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().min(0).max(10000) }).parse(req.body);
  const result = await tx(async (c) => setItem(c, await ensureCart(c, req.user.id), d.product_id, d.quantity));
  res.json({ ...(await readCart(req.user.id)), ...result });
}));

r.delete('/items/:pid', asyncH(async (req, res) => {
  await query(`DELETE FROM cart_items WHERE product_id=$1 AND cart_id=(SELECT id FROM carts WHERE user_id=$2)`, [req.params.pid, req.user.id]);
  res.json(await readCart(req.user.id));
}));

r.delete('/', asyncH(async (req, res) => {
  await query(`DELETE FROM cart_items WHERE cart_id=(SELECT id FROM carts WHERE user_id=$1)`, [req.user.id]);
  res.json({ items: [], subtotal: 0 });
}));

// Fusionne le panier "invité" (stocké sur l'appareil) avec le panier du compte à la connexion
r.post('/merge', asyncH(async (req, res) => {
  const { items } = z.object({ items: itemsSchema.or(z.array(z.any()).max(0)) }).parse(req.body);
  const skipped = [];
  await tx(async (c) => {
    const cartId = await ensureCart(c, req.user.id);
    const existing = new Map((await c.query('SELECT product_id, quantity FROM cart_items WHERE cart_id=$1', [cartId])).rows.map((x) => [x.product_id, Number(x.quantity)]));
    for (const it of mergeItems(items)) {
      try { await c.query('SAVEPOINT s'); await setItem(c, cartId, it.product_id, Math.max(it.quantity, existing.get(it.product_id) || 0)); await c.query('RELEASE SAVEPOINT s'); }
      catch (e) { await c.query('ROLLBACK TO SAVEPOINT s'); skipped.push({ product_id: it.product_id, message: e.message }); }
    }
  });
  res.json({ ...(await readCart(req.user.id)), skipped });
}));

export { readCart };
export default r;
