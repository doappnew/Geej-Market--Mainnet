import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { PRODUCT_SELECT, PUBLIC_WHERE } from '../lib/products.js';
import { HttpError, asyncH, numericParams } from '../util.js';

const r = Router();
numericParams(r, 'id', 'pid', 'imageId');

r.get('/categories', asyncH(async (_req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.slug, c.name, c.image_url,
            (SELECT count(*) FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.category_id = c.id AND p.is_active AND s.is_active) AS product_count
     FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.id`);
  res.json({ categories: rows });
}));

const listSchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(50).optional(),
  condition: z.enum(['frais', 'congelé', 'fumé', 'séché', 'salé', 'autre']).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  available: z.enum(['1', '0']).optional(),
  promo: z.enum(['1', '0']).optional(),
  featured: z.enum(['1', '0']).optional(),
  sort: z.enum(['popular', 'new', 'price_asc', 'price_desc', 'name']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});
const ORDER = {
  popular: 'p.orders_count DESC, p.created_at DESC', new: 'p.created_at DESC',
  price_asc: 'COALESCE(p.promo_price, p.price) ASC', price_desc: 'COALESCE(p.promo_price, p.price) DESC', name: 'p.name ASC',
};

r.get('/products', asyncH(async (req, res) => {
  const f = listSchema.parse(req.query);
  const where = [PUBLIC_WHERE]; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.search) add(`(unaccent_lite(p.name) ILIKE unaccent_lite(?) OR unaccent_lite(p.description) ILIKE unaccent_lite(?) OR unaccent_lite(c.name) ILIKE unaccent_lite(?))`, `%${f.search.replace(/[%_\\]/g, '\\$&')}%`);
  if (f.category) add('c.slug = ?', f.category);
  if (f.condition) add('p.condition = ?', f.condition);
  if (f.min_price != null) add('COALESCE(p.promo_price, p.price) >= ?', f.min_price);
  if (f.max_price != null) add('COALESCE(p.promo_price, p.price) <= ?', f.max_price);
  if (f.available === '1') where.push(`p.stock >= p.min_qty AND (p.available_from IS NULL OR p.available_from <= CURRENT_DATE)`);
  if (f.promo === '1') where.push('(p.promo_price IS NOT NULL AND p.promo_price < p.price)');
  if (f.featured === '1') where.push('p.is_featured');
  const w = where.join(' AND ');
  const total = (await query(`SELECT count(*)::int AS n FROM products p JOIN categories c ON c.id=p.category_id JOIN sellers s ON s.id=p.seller_id WHERE ${w}`, params)).rows[0].n;
  const { rows } = await query(`${PRODUCT_SELECT} WHERE ${w} ORDER BY ${ORDER[f.sort]}, p.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  res.json({ items: rows, total, page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)) });
}));

r.get('/products/:id', asyncH(async (req, res) => {
  const { rows } = await query(`${PRODUCT_SELECT} WHERE p.id = $1 AND ${PUBLIC_WHERE}`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Produit introuvable.', 'not_found');
  res.json({ product: rows[0] });
}));

r.get('/home', asyncH(async (_req, res) => {
  const section = async (extra, order, limit = 10) =>
    (await query(`${PRODUCT_SELECT} WHERE ${PUBLIC_WHERE} ${extra} ORDER BY ${order}, p.id LIMIT ${limit}`)).rows;
  const [popular, recent, promos, featured, available] = await Promise.all([
    section('', 'p.orders_count DESC, p.created_at DESC'),
    section('', 'p.created_at DESC'),
    section('AND p.promo_price IS NOT NULL AND p.promo_price < p.price', 'p.created_at DESC'),
    section('AND p.is_featured', 'p.created_at DESC'),
    section('AND p.stock >= p.min_qty', 'p.name'),
  ]);
  const cats = (await query(`SELECT id, slug, name, image_url FROM categories WHERE is_active ORDER BY sort_order, id`)).rows;
  res.json({ categories: cats, popular, recent, promos, featured, available });
}));

// ---- Géographie / livraison ----
r.get('/geo/regions', asyncH(async (_req, res) => {
  const { rows } = await query(`SELECT id, name FROM regions ORDER BY name`);
  res.json({ regions: rows });
}));
r.get('/geo/departments', asyncH(async (req, res) => {
  const regionId = z.coerce.number().int().positive().parse(req.query.region_id);
  const { rows } = await query(`SELECT id, name FROM departments WHERE region_id = $1 ORDER BY name`, [regionId]);
  res.json({ departments: rows });
}));
// Régions réellement desservies par au moins un vendeur actif (pour informer le client)
r.get('/geo/served', asyncH(async (_req, res) => {
  const { rows } = await query(
    `SELECT dz.region_id, r.name, min(dz.fee) AS min_fee, bool_or(dz.pickup_available) AS pickup
     FROM delivery_zones dz JOIN regions r ON r.id = dz.region_id JOIN sellers s ON s.id = dz.seller_id
     WHERE dz.is_active AND s.is_active GROUP BY dz.region_id, r.name ORDER BY r.name`);
  res.json({ served: rows });
}));

// Options publiques. Tous les prix sont en Pi; le paiement n'est possible que si la clé API Pi est configurée.
r.get('/config', asyncH(async (_req, res) => {
  const { rows } = await query(`SELECT key, value FROM settings`);
  const s = Object.fromEntries(rows.map((x) => [x.key, x.value]));
  res.json({ currency: 'PI', pi_payment_enabled: !!process.env.PI_API_KEY, support_phone: s.support_phone || '', support_whatsapp: s.support_whatsapp || '' });
}));

export default r;
