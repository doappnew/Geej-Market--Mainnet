import { z } from 'zod';

export const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.price, p.promo_price,
         COALESCE(p.promo_price, p.price) AS effective_price,
         (p.promo_price IS NOT NULL AND p.promo_price < p.price) AS is_promo,
         p.unit, p.unit_detail, p.qty_step, p.min_qty, p.stock, p.condition, p.storage_info,
         p.available_from, p.prepared_on, p.traceability, p.is_active, p.is_featured, p.orders_count, p.created_at,
         p.category_id, c.slug AS category_slug, c.name AS category_name,
         p.seller_id, s.shop_name, s.city AS seller_city, s.description AS seller_description,
         (p.is_active AND s.is_active AND p.stock >= p.min_qty AND (p.available_from IS NULL OR p.available_from <= CURRENT_DATE)) AS available,
         COALESCE((SELECT json_agg(url ORDER BY sort_order, id) FROM product_images WHERE product_id = p.id), '[]'::json) AS images
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN sellers s ON s.id = p.seller_id`;

export const PUBLIC_WHERE = `p.is_active AND s.is_active AND c.is_active`;

// Les quantités doivent respecter le pas de vente (ex: 0,5 kg) et le minimum.
export function checkQty(product, qty) {
  const step = Number(product.qty_step), min = Number(product.min_qty);
  if (!(qty >= min - 1e-9)) return `Quantité minimale: ${min} ${product.unit}.`;
  const k = qty / step;
  if (Math.abs(k - Math.round(k)) > 1e-6) return `La quantité doit être un multiple de ${step} ${product.unit}.`;
  return null;
}

export const itemsSchema = z.array(z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().max(10000),
})).min(1).max(50);

// Fusionne les doublons de produit
export function mergeItems(items) {
  const m = new Map();
  for (const it of items) m.set(it.product_id, +(((m.get(it.product_id) || 0) + it.quantity)).toFixed(3));
  return [...m].map(([product_id, quantity]) => ({ product_id, quantity }));
}
