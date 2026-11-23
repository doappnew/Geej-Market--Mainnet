// Intégration Pi Network (navigateur). Rien n'est simulé: hors Pi Browser, les fonctions Pi sont simplement indisponibles.
import { api } from './api.js';

let inited = false;
export const piAvailable = () => typeof window !== 'undefined' && !!window.Pi;
export const inPiBrowser = () => piAvailable(); // le SDK Pi n'existe que dans Pi Browser

// Le SDK Pi est chargé en différé: attend sa présence (jusqu'à `ms`) avant de conclure qu'il est absent.
export async function waitForPi(ms = 6000) {
  const t0 = Date.now();
  while (!piAvailable() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
  return piAvailable();
}

function init() {
  if (!piAvailable()) throw new Error("Le SDK Pi n'est pas disponible. Ouvrez GÉEJ MARKET dans Pi Browser.");
  if (!inited) { window.Pi.init({ version: '2.0' }); inited = true; }
}

// Connexion: Pi.authenticate -> le serveur vérifie lui-même le jeton auprès de Pi.
export async function piLogin(linkToExisting = false) {
  if (!(await waitForPi())) throw new Error("Connexion Pi impossible : le SDK Pi est absent (non chargé). Ouvrez GÉEJ MARKET dans Pi Browser, vérifiez votre connexion internet puis réessayez.");
  try { init(); } catch (e) { throw new Error(`Connexion Pi impossible : initialisation du SDK Pi échouée (${e?.message || 'erreur inconnue'}).`); }
  let incomplete = null;
  let auth;
  try {
    auth = await window.Pi.authenticate(['username', 'payments'], (payment) => { incomplete = payment; });
  } catch (e) {
    const raw = (typeof e === 'string' ? e : e?.message) || 'erreur inconnue';
    if (/cancel|closed|denied|refus/i.test(raw)) throw new Error(`Connexion Pi annulée ou refusée dans Pi Browser (${raw}).`);
    throw new Error(`Connexion Pi bloquée par Pi Network (${raw}). Vérifiez dans le Developer Portal que l’adresse de l’application est enregistrée et vérifiée pour le réseau Mainnet.`);
  }
  if (!auth?.accessToken) throw new Error('Connexion Pi bloquée : Pi n’a renvoyé aucun jeton d’accès.');
  try {
    const res = await api.post(linkToExisting ? '/api/auth/pi/link' : '/api/auth/pi', { accessToken: auth.accessToken });
    return { ...res, incomplete };
  } catch (e) {
    throw new Error(`Connexion refusée par le serveur GÉEJ MARKET (${e?.status ? `code ${e.status} : ` : ''}${e?.message || 'erreur inconnue'}).`);
  }
}

// Reprend un paiement interrompu (à appeler une fois la session ouverte)
export async function handleIncomplete(payment) {
  if (!payment) return;
  try { await api.post('/api/pay/pi/incomplete', { paymentId: payment.identifier, txid: payment.transaction?.txid }); } catch { /* sera réessayé */ }
}

// Paiement d'une commande en Pi: montant et référence fixés par le serveur.
export function payOrderWithPi(orderId, { onStatus } = {}) {
  init();
  return new Promise(async (resolve, reject) => {
    let intent;
    try { intent = await api.post(`/api/pay/orders/${orderId}/pi-payment`); } catch (e) { return reject(e); }
    window.Pi.createPayment(
      { amount: intent.amount, memo: intent.memo, metadata: intent.metadata },
      {
        onReadyForServerApproval: async (paymentId) => {
          onStatus?.('Validation du paiement…');
          try { await api.post('/api/pay/pi/approve', { paymentId }); } catch (e) { reject(e); }
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          onStatus?.('Confirmation de la transaction…');
          try { await api.post('/api/pay/pi/complete', { paymentId, txid }); resolve({ ok: true }); } catch (e) { reject(e); }
        },
        onCancel: async (paymentId) => {
          try { await api.post('/api/pay/pi/cancelled', { paymentId }); } catch { /* ignoré */ }
          reject(Object.assign(new Error('Paiement annulé.'), { cancelled: true }));
        },
        onError: (error) => reject(new Error(error?.message || 'Erreur de paiement Pi.')),
      },
    );
  });
}

