import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Numéro sénégalais -> 9 chiffres (ex: 771234567). Retourne null si invalide.
export function normalizePhone(input) {
  if (!input) return null;
  let d = String(input).replace(/[^\d+]/g, '');
  d = d.replace(/^\+?221/, '').replace(/^00221/, '');
  d = d.replace(/\D/g, '');
  return /^(70|75|76|77|78|30|33)\d{7}$/.test(d) ? d : null;
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const randomToken = (n = 24) => crypto.randomBytes(n).toString('base64url');

// Montants en Pi: 7 décimales maximum (précision de Pi)
export const pi7 = (n) => Math.round(Number(n) * 1e7) / 1e7;

export const ORDER_STATUSES = [
  'en_attente_paiement', 'nouvelle', 'en_attente_confirmation', 'confirmee',
  'en_preparation', 'prete', 'en_livraison', 'livree', 'annulee',
];

// Transitions autorisées pour le vendeur
export const SELLER_TRANSITIONS = {
  nouvelle: ['en_attente_confirmation', 'confirmee', 'annulee'],
  en_attente_confirmation: ['confirmee', 'annulee'],
  confirmee: ['en_preparation', 'annulee'],
  en_preparation: ['prete', 'annulee'],
  prete: ['en_livraison', 'livree', 'annulee'],
  en_livraison: ['livree', 'annulee'],
  en_attente_paiement: ['annulee'],
  livree: [],
  annulee: [],
};

export const DELIVERY_MODES = ['domicile', 'professionnelle', 'retrait_vente', 'retrait_relais'];
export const isPickup = (m) => m === 'retrait_vente' || m === 'retrait_relais';

// Express 5: pas de regex dans les chemins -> validation des paramètres numériques
export function numericParams(router, ...names) {
  for (const n of names) router.param(n, (_req, _res, next, v) => (/^\d{1,10}$/.test(v) ? next() : next('route')));
  return router;
}
