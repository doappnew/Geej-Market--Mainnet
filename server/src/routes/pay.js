// Paiement Pi: tout est décidé et vérifié côté serveur. Commande et paiement sont deux opérations distinctes.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, asyncH, numericParams, pi7 } from '../util.js';
import { piApprove, piComplete, piGetPayment, piCancel, piConfigured } from '../pi.js';
import { audit, notify } from '../audit.js';

const r = Router();
numericParams(r, 'id');
r.use(requireAuth);

const orderTotal = (o) => pi7(Number(o.final_total ?? o.total));

// 1) Le client demande à payer: le serveur fixe le montant en Pi (taux défini par l'admin) et l'enregistre.
r.post('/orders/:id/pi-payment', asyncH(async (req, res) => {
  if (!piConfigured()) throw new HttpError(503, "Paiement Pi non configuré.", 'pi_not_configured');
  if (!req.user.pi_uid) throw new HttpError(409, 'Connectez-vous avec Pi pour payer en Pi.', 'pi_login_required');
  const out = await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
    if (!o) throw new HttpError(404, 'Commande introuvable.', 'not_found');
    if (o.payment_status === 'paye') throw new HttpError(409, 'Commande déjà payée.', 'already_paid');
    if (['annulee', 'livree'].includes(o.status)) throw new HttpError(409, 'Commande non payable.', 'not_payable');
    const amount_pi = orderTotal(o);
    let p = (await c.query(`SELECT * FROM payments WHERE order_id=$1 AND method='pi' AND status IN ('en_attente','en_cours','echoue') ORDER BY id DESC LIMIT 1`, [o.id])).rows[0];
    if (p && p.status !== 'en_cours') {
      await c.query(`UPDATE payments SET amount_pi=$1, status='en_attente' WHERE id=$2`, [amount_pi, p.id]);
    } else if (!p) {
      p = (await c.query(`INSERT INTO payments(order_id,method,amount_pi,status) VALUES ($1,'pi',$2,'en_attente') RETURNING *`, [o.id, amount_pi])).rows[0];
    }
    const pay = (await c.query('SELECT * FROM payments WHERE id=$1', [p.id])).rows[0];
    return { payment_id: pay.id, amount: Number(pay.amount_pi), memo: `GÉEJ MARKET ${o.order_no}`, metadata: { order_id: o.id, order_no: o.order_no, payment_id: pay.id } };
  });
  res.json(out);
}));

// Vérifie qu'un paiement Pi correspond bien à une commande du bon utilisateur, au bon montant.
async function resolve(piPayment, userId) {
  const meta = piPayment?.metadata || {};
  const payId = Number(meta.payment_id);
  if (!payId) throw new HttpError(400, 'Paiement Pi sans référence de commande.', 'no_ref');
  const row = (await query(
    `SELECT p.*, o.user_id, o.order_no, o.status AS order_status, o.seller_id, o.payment_status
     FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id=$1 AND p.method='pi'`, [payId])).rows[0];
  if (!row || row.user_id !== userId) throw new HttpError(403, 'Paiement non rattaché à ce compte.', 'forbidden');
  if (piPayment.user_uid !== undefined && piPayment.user_uid !== (await query('SELECT pi_uid FROM users WHERE id=$1', [userId])).rows[0].pi_uid) throw new HttpError(403, 'Le paiement Pi appartient à un autre compte Pi.', 'wrong_pi_user');
  if (Math.abs(Number(piPayment.amount) - Number(row.amount_pi)) > 1e-7) throw new HttpError(409, 'Montant Pi différent du montant attendu.', 'amount_mismatch');
  return row;
}

// Garde-fou Mainnet: tout paiement d'un autre réseau (ex. Pi Testnet) est refusé.
const mainnetOnly = (p) => { if (p?.network !== 'Pi Network') throw new HttpError(409, 'Paiement refusé : réseau Pi non autorisé.', 'wrong_network'); };

// 2) Callback onReadyForServerApproval
r.post('/pi/approve', asyncH(async (req, res) => {
  const { paymentId } = z.object({ paymentId: z.string().min(5).max(200) }).parse(req.body);
  const piPayment = await piGetPayment(paymentId);
  mainnetOnly(piPayment);
  const row = await resolve(piPayment, req.user.id);
  if (row.payment_status === 'paye') return res.json({ ok: true, already: true });
  if (['annulee'].includes(row.order_status)) throw new HttpError(409, 'Commande annulée.', 'not_payable');
  if (piPayment.status?.cancelled || piPayment.status?.user_cancelled) throw new HttpError(409, 'Paiement Pi annulé.', 'cancelled');
  await query(
    `INSERT INTO pi_transactions(payment_id,pi_payment_id,pi_uid,amount_pi,status,raw) VALUES ($1,$2,$3,$4,'cree',$5)
     ON CONFLICT(pi_payment_id) DO UPDATE SET updated_at=now()`,
    [row.id, paymentId, piPayment.user_uid || null, piPayment.amount, JSON.stringify({ identifier: piPayment.identifier, status: piPayment.status })]);
  if (!piPayment.status?.developer_approved) await piApprove(paymentId);
  await query(`UPDATE pi_transactions SET status='approuve', updated_at=now() WHERE pi_payment_id=$1`, [paymentId]);
  await query(`UPDATE payments SET status='en_cours' WHERE id=$1 AND status<>'paye'`, [row.id]);
  await query(`UPDATE orders SET payment_status='en_cours', updated_at=now() WHERE id=$1 AND payment_status<>'paye'`, [row.order_id]);
  await audit(req, 'pi.approve', 'payment', row.id, { pi_payment_id: paymentId });
  res.json({ ok: true });
}));

// 3) Callback onReadyForServerCompletion — idempotent
async function completePayment(req, paymentId, txid) {
  const piPayment = await piGetPayment(paymentId);
  mainnetOnly(piPayment);
  const row = await resolve(piPayment, req.user.id);
  if (row.payment_status === 'paye' || row.status === 'paye') return { ok: true, already: true, order_id: row.order_id };
  const st = piPayment.status || {};
  const realTx = txid || piPayment.transaction?.txid;
  if (!st.developer_approved) throw new HttpError(409, "Paiement non approuvé par le serveur.", 'not_approved');
  if (st.cancelled || st.user_cancelled) throw new HttpError(409, 'Paiement annulé.', 'cancelled');
  if (!realTx) throw new HttpError(409, 'Transaction blockchain introuvable.', 'no_txid');
  if (piPayment.transaction?.txid && piPayment.transaction.txid !== realTx) throw new HttpError(409, 'Transaction différente de celle enregistrée par Pi.', 'txid_mismatch');
  // Doc Pi: c'est /complete qui vérifie la transaction sur la blockchain. Réponse non-200 => on ne marque RIEN comme payé.
  if (!st.developer_completed) await piComplete(paymentId, realTx);
  await tx(async (c) => {
    await c.query(`UPDATE pi_transactions SET status='complete', txid=$2, updated_at=now() WHERE pi_payment_id=$1`, [paymentId, realTx]);
    await c.query(`UPDATE payments SET status='paye', paid_at=now() WHERE id=$1`, [row.id]);
    await c.query(`UPDATE orders SET payment_status='paye', status=CASE WHEN status='en_attente_paiement' THEN 'nouvelle' ELSE status END, updated_at=now() WHERE id=$1`, [row.order_id]);
    if (row.order_status === 'en_attente_paiement') {
      await c.query(`INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES ($1,'nouvelle','Paiement en Pi confirmé',$2)`, [row.order_id, req.user.id]);
    }
    const su = (await c.query('SELECT user_id FROM sellers WHERE id=$1', [row.seller_id])).rows[0];
    await notify(c, su.user_id, 'payment_confirmed', 'Paiement confirmé', `${row.order_no} payée en Pi.`, row.order_id);
    await notify(c, row.user_id, 'payment_confirmed', 'Paiement confirmé', `Votre paiement pour ${row.order_no} a été confirmé.`, row.order_id);
    await audit(req, 'pi.complete', 'payment', row.id, { pi_payment_id: paymentId, txid: realTx }, c);
  });
  return { ok: true, order_id: row.order_id };
}

r.post('/pi/complete', asyncH(async (req, res) => {
  const { paymentId, txid } = z.object({ paymentId: z.string().min(5).max(200), txid: z.string().min(5).max(200).optional() }).parse(req.body);
  res.json(await completePayment(req, paymentId, txid));
}));

// 4) Paiement annulé par l'utilisateur ou expiré
r.post('/pi/cancelled', asyncH(async (req, res) => {
  const { paymentId } = z.object({ paymentId: z.string().min(5).max(200) }).parse(req.body);
  const piPayment = await piGetPayment(paymentId);
  const row = await resolve(piPayment, req.user.id);
  const cancelledAtPi = !!(piPayment.status?.cancelled || piPayment.status?.user_cancelled);
  if (!cancelledAtPi) throw new HttpError(409, "Ce paiement n'est pas annulé côté Pi.", 'not_cancelled');
  if (row.payment_status !== 'paye') {
    await query(`UPDATE pi_transactions SET status='annule', updated_at=now() WHERE pi_payment_id=$1`, [paymentId]);
    await query(`UPDATE payments SET status='echoue' WHERE id=$1 AND status<>'paye'`, [row.id]);
    await query(`UPDATE orders SET payment_status='non_paye', updated_at=now() WHERE id=$1 AND payment_status<>'paye'`, [row.order_id]);
  }
  res.json({ ok: true });
}));

// 5) Paiement incomplet retrouvé à la connexion (onIncompletePaymentFound)
r.post('/pi/incomplete', asyncH(async (req, res) => {
  const { paymentId, txid } = z.object({ paymentId: z.string().min(5).max(200), txid: z.string().min(5).max(200).optional() }).parse(req.body);
  const piPayment = await piGetPayment(paymentId);
  const st = piPayment.status || {};
  if (st.cancelled || st.user_cancelled) { await piCancel(paymentId).catch(() => {}); return res.json({ ok: true, cancelled: true }); }
  if (piPayment.transaction?.txid || txid) return res.json(await completePayment(req, paymentId, txid));
  res.json({ ok: true, pending: true });
}));

// Historique des paiements du client
r.get('/payments', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.method, p.amount_pi, p.status, p.created_at, p.paid_at, o.order_no, t.txid
     FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN pi_transactions t ON t.payment_id=p.id
     WHERE o.user_id=$1 ORDER BY p.id DESC LIMIT 100`, [req.user.id]);
  res.json({ payments: rows });
}));

export default r;
