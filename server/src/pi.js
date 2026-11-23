// Client minimal de l'API Pi Network (serveur uniquement). Aucune simulation: sans clé, les appels échouent explicitement.
import { config } from './config.js';
import { HttpError } from './util.js';

const BASE = process.env.PI_API_BASE || 'https://api.minepi.com';

async function call(label, path, { method = 'GET', headers = {}, body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    console.error(`pi: ${label} réseau`, e.message);
    throw new HttpError(502, "Impossible de joindre l'API Pi Network.", 'pi_unreachable');
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    // Playbook: journaliser statut + code d'erreur Pi (jamais de clé ni de jeton)
    console.error(`pi: ${label} API Pi ${method} ${path.replace(/\/v2\/payments\/[^/]+/, '/v2/payments/{id}')} ${res.status} ${json?.error || json?.error_message || ''}`);
    const err = new HttpError(res.status === 404 ? 404 : 502, `Pi Network: ${json?.error_message || json?.error || 'erreur'}`, json?.error || 'pi_error');
    err.piStatus = res.status;
    throw err;
  }
  return json;
}

export const piConfigured = () => !!config.piApiKey;
const keyHeader = () => {
  if (!config.piApiKey) throw new HttpError(503, "Paiement Pi non configuré (PI_API_KEY manquante).", 'pi_not_configured');
  return { Authorization: `Key ${config.piApiKey}` };
};

// Vérifie un accessToken utilisateur (pas de clé API nécessaire)
export const piMe = (accessToken) => call('auth', '/v2/me', { headers: { Authorization: `Bearer ${accessToken}` } });
export const piGetPayment = (id) => call('payments', `/v2/payments/${encodeURIComponent(id)}`, { headers: keyHeader() });
export const piApprove = (id) => call('payments', `/v2/payments/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: keyHeader() });
export const piComplete = (id, txid) => call('payments', `/v2/payments/${encodeURIComponent(id)}/complete`, { method: 'POST', headers: keyHeader(), body: { txid } });
export const piCancel = (id) => call('payments', `/v2/payments/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: keyHeader() });
