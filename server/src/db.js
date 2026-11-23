import pg from 'pg';
import { config } from './config.js';

// NUMERIC -> nombre JS (quantités/prix de petite taille, pas de risque de précision ici)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD'
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
