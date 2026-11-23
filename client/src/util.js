export const piFmt = (n) => { const v = Math.round((Number(n) || 0) * 1e7) / 1e7; return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 7 }).replace(/[\u202f\u00a0]/g, ' ')} π`; };
export const num = (n) => String(Number(n)).replace('.', ',');
export const unitLabel = (p) => (p.unit_detail ? `${p.unit} (${p.unit_detail})` : p.unit);
export const qtyLabel = (q, unit) => `${num(q)} ${unit}`;
export const dateFr = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dayFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export const STATUS = {
  en_attente_paiement: ['En attente de paiement', 'amber'],
  nouvelle: ['Nouvelle commande', 'blue'],
  en_attente_confirmation: ['En attente de confirmation', 'amber'],
  confirmee: ['Confirmée', 'green'],
  en_preparation: ['En préparation', 'blue'],
  prete: ['Prête à être livrée', 'green'],
  en_livraison: ['En cours de livraison', 'blue'],
  livree: ['Livrée', 'green'],
  annulee: ['Annulée', 'red'],
};
export const PAY_STATUS = { non_paye: ['Non payé', 'grey'], en_cours: ['Paiement en cours', 'amber'], paye: ['Payé', 'green'], echoue: ['Échoué', 'red'], rembourse: ['Remboursé', 'grey'] };
export const PAY_METHOD = { pi: 'Paiement en Pi (π)' };
export const MODES = {
  domicile: 'Livraison à domicile', professionnelle: 'Livraison à une adresse professionnelle',
  retrait_vente: 'Retrait à un point de vente', retrait_relais: 'Retrait auprès d’un point de distribution',
};
export const CONDITIONS = ['frais', 'congelé', 'fumé', 'séché', 'salé', 'autre'];
export const UNITS = ['kg', 'demi-kg', 'pièce', 'lot', 'paquet', 'carton'];

export const phoneFmt = (p) => (p && p.length === 9 ? `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 7)} ${p.slice(7)}` : p || '');
export const waLink = (p, text = '') => `https://wa.me/${p?.startsWith('221') ? p : `221${p}`}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
