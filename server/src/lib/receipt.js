// Reçu de paiement: généré uniquement pour une commande réellement payée en Pi (paiement vérifié côté serveur).
// Le code de contrôle est calculé avec la clé secrète du serveur: il ne peut pas être deviné ni fabriqué par le client.
import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';

export const receiptCode = (orderNo, txid) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`receipt|${orderNo}|${txid || ''}`).digest('hex').slice(0, 10).toUpperCase().replace(/(.{5})(.{5})/, '$1-$2');

export const sameCode = (a, b) => {
  const x = Buffer.from(String(a || '').trim().toUpperCase()); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Charge les données d'un reçu. `scope` limite à un client ou à un vendeur.
export async function loadReceipt(where, params) {
  const o = (await query(
    `SELECT o.id, o.order_no, o.status, o.payment_status, o.total, o.final_total, o.customer_name, o.delivery_mode, o.commune, o.created_at,
            s.shop_name, p.paid_at, p.amount_pi, t.txid
     FROM orders o JOIN sellers s ON s.id=o.seller_id
     LEFT JOIN payments p ON p.order_id=o.id AND p.status='paye'
     LEFT JOIN pi_transactions t ON t.payment_id=p.id AND t.status='complete'
     WHERE ${where}`, params)).rows[0];
  if (!o) return null;
  o.items = (await query('SELECT product_name, unit, unit_price, quantity, line_total FROM order_items WHERE order_id=$1 ORDER BY id', [o.id])).rows;
  o.paid = o.payment_status === 'paye' && !!o.paid_at;
  o.code = o.paid ? receiptCode(o.order_no, o.txid) : null;
  return o;
}
