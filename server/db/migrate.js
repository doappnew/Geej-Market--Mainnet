import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (config.dbSchema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${config.dbSchema}`);
const sql = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
await pool.query(sql);
for (const f of fs.readdirSync(path.join(dir, 'migrations')).sort()) {
  await pool.query(fs.readFileSync(path.join(dir, 'migrations', f), 'utf8'));
}
console.log('Schéma appliqué.');
await pool.end();
