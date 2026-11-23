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

// Schéma dédié: chaque connexion travaille dans ce schéma (jamais dans « public », où se trouvent les données d'une autre version).
if (config.dbSchema) {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(config.dbSchema) || config.dbSchema === 'public') throw new Error('DB_SCHEMA invalide (minuscules, chiffres et _ ; pas « public »).');
  // Le mode « transaction » du pooler Supabase (port 6543) ne garde pas l'état d'une connexion: refusé pour éviter d'écrire dans le mauvais schéma.
  if (/:6543\//.test(config.databaseUrl)) throw new Error('DB_SCHEMA exige la connexion Supabase en mode « session » (port 5432), pas le port 6543.');
  pool.on('connect', (client) => { client.query(`SET search_path TO ${config.dbSchema}`).catch(() => {}); });
}

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
