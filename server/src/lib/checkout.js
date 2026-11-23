import { HttpError, isPickup, pi7 } from '../util.js';
import { checkQty } from './products.js';

// Construit le plan de commandes (une commande par vendeur). `client` = connexion pg (transaction pour lock=true).
export async function planOrders(client, items, { regionId, commune, mode }, { lock = false, strict = true } = {}) {
  const ids = items.map((i) => i.product_id);
  const { rows: prods } = await client.query(
    `SELECT p.*, s.shop_name, s.is_active AS seller_active, c.is_active AS cat_active,
            (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_url
     FROM products p JOIN sellers s ON s.id = p.seller_id JOIN categories c ON c.id = p.category_id
     WHERE p.id = ANY($1::int[]) ${lock ? 'ORDER BY p.id FOR UPDATE OF p' : ''}`, [ids]);
  const byId = new Map(prods.map((p) => [p.id, p]));
  const problems = [];
  const groups = new Map();
  for (const it of items) {
    const p = byId.get(it.product_id);
    if (!p || !p.is_active || !p.seller_active || !p.cat_active) { problems.push({ product_id: it.product_id, message: "Produit indisponible." }); continue; }
    if (p.available_from && new Date(p.available_from) > new Date()) { problems.push({ product_id: p.id, message: `${p.name}: pas encore disponible.` }); continue; }
    const qErr = checkQty(p, it.quantity);
    if (qErr) { problems.push({ product_id: p.id, message: `${p.name}: ${qErr}` }); continue; }
    if (it.quantity > Number(p.stock) + 1e-9) { problems.push({ product_id: p.id, message: `${p.name}: stock insuffisant (${p.stock} ${p.unit} disponible).` }); continue; }
    const unit_price = p.promo_price != null && p.promo_price < p.price ? p.promo_price : p.price;
    const line = { product_id: p.id, product_name: p.name, unit: p.unit, unit_price, quantity: it.quantity, line_total: pi7(unit_price * it.quantity), image_url: p.image_url };
    if (!groups.has(p.seller_id)) groups.set(p.seller_id, { seller_id: p.seller_id, shop_name: p.shop_name, lines: [], subtotal: 0 });
    const g = groups.get(p.seller_id);
    g.lines.push(line);
    g.subtotal = pi7(g.subtotal + line.line_total);
  }
  if (problems.length && strict) {
    const e = new HttpError(422, problems.map((x) => x.message).join(' '), 'cart_invalid');
    e.problems = problems;
    throw e;
  }
  const out = [];
  for (const g of groups.values()) {
    let zone = null, served = false, reason = null, fee = 0;
    if (regionId) {
      const z = await client.query(
        `SELECT * FROM delivery_zones WHERE seller_id=$1 AND region_id=$2 AND is_active
           AND (commune IS NULL OR lower(commune) = lower($3)) ORDER BY commune NULLS LAST LIMIT 1`,
        [g.seller_id, regionId, commune || '']);
      zone = z.rows[0] || null;
      if (!zone) reason = `${g.shop_name} ne livre pas encore dans cette zone.`;
      else if (mode && isPickup(mode) && !zone.pickup_available) reason = `Le retrait n'est pas proposé par ${g.shop_name} dans cette zone.`;
      else if (mode && !isPickup(mode) && !zone.home_delivery) reason = `La livraison à domicile n'est pas proposée par ${g.shop_name} dans cette zone.`;
      else if (g.subtotal < zone.min_order) reason = `Montant minimum de commande pour ${g.shop_name}: ${zone.min_order} π.`;
      else { served = true; fee = mode && isPickup(mode) ? 0 : zone.fee; }
    }
    out.push({ ...g, zone, served, reason, fee, eta_text: zone?.eta_text || null, total: pi7(g.subtotal + fee) });
  }
  return { sellers: out, problems };
}
