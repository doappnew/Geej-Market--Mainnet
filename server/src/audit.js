import { query } from './db.js';

// Journalisation des opérations importantes. Ne jamais y mettre de mot de passe ni de jeton.
export async function audit(req, action, entity = null, entityId = null, details = null, client = null) {
  const run = client ? client.query.bind(client) : query;
  try {
    await run(
      `INSERT INTO audit_logs(actor_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, req?.ip ?? null]);
  } catch (e) { console.error('audit failed', e.message); }
}

export async function notify(client, userId, type, title, body = null, orderId = null) {
  const run = client ? client.query.bind(client) : query;
  await run(`INSERT INTO notifications(user_id,type,title,body,order_id) VALUES ($1,$2,$3,$4,$5)`, [userId, type, title, body, orderId]);
}
