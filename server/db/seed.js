// Données de référence (toujours) + données de démonstration (option --demo)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../src/db.js';

const demo = process.argv.includes('--demo');

const REGIONS = {
  Dakar: ['Dakar', 'Guédiawaye', 'Pikine', 'Rufisque', 'Keur Massar'],
  Thiès: ['Thiès', 'Mbour', 'Tivaouane'],
  Diourbel: ['Diourbel', 'Bambey', 'Mbacké'],
  Fatick: ['Fatick', 'Foundiougne', 'Gossas'],
  Kaffrine: ['Kaffrine', 'Birkelane', 'Koungheul', 'Malem Hodar'],
  Kaolack: ['Kaolack', 'Guinguinéo', 'Nioro du Rip'],
  Kédougou: ['Kédougou', 'Salémata', 'Saraya'],
  Kolda: ['Kolda', 'Médina Yoro Foulah', 'Vélingara'],
  Louga: ['Louga', 'Kébémer', 'Linguère'],
  Matam: ['Matam', 'Kanel', 'Ranérou'],
  'Saint-Louis': ['Saint-Louis', 'Dagana', 'Podor'],
  Sédhiou: ['Sédhiou', 'Bounkiling', 'Goudomp'],
  Tambacounda: ['Tambacounda', 'Bakel', 'Goudiry', 'Koumpentoum'],
  Ziguinchor: ['Ziguinchor', 'Bignona', 'Oussouye'],
};

const CATEGORIES = [
  ['poissons', 'Poissons', '/img/cats/poissons.jpg'],
  ['crustaces', 'Crustacés', '/img/cats/crustaces.jpg'],
  ['mollusques', 'Mollusques & Coquillages', '/img/cats/mollusques.jpg'],
  ['transformes', 'Produits transformés', '/img/cats/transformes.jpg'],
];

async function main() {
  for (const [region, deps] of Object.entries(REGIONS)) {
    const r = await pool.query('INSERT INTO regions(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [region]);
    for (const d of deps) {
      await pool.query('INSERT INTO departments(region_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [r.rows[0].id, d]);
    }
  }
  let i = 0;
  for (const [slug, name, img] of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories(slug,name,image_url,sort_order) VALUES($1,$2,$3,$4)
       ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, image_url=EXCLUDED.image_url, sort_order=EXCLUDED.sort_order`,
      [slug, name, img, i++]);
  }
  // Tous les prix sont en Pi (π). Aucune autre monnaie, aucun taux de conversion.
  await pool.query(`INSERT INTO settings(key,value) VALUES ('support_phone',''),('support_whatsapp','') ON CONFLICT DO NOTHING`);

  // Administrateur initial
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@geejmarket.sn').toLowerCase();
  const exists = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
  if (!exists.rowCount) {
    const pwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const u = await pool.query(
      `INSERT INTO users(full_name,email,password_hash,role) VALUES ('Administrateur GÉEJ',$1,$2,'admin') RETURNING id`,
      [adminEmail, await bcrypt.hash(pwd, 12)]);
    await pool.query(`INSERT INTO admins(user_id,level) VALUES ($1,'super_admin')`, [u.rows[0].id]);
    console.log(`Admin créé: ${adminEmail} / ${process.env.ADMIN_PASSWORD ? '(mot de passe ADMIN_PASSWORD)' : pwd}  <- notez-le, il n'est affiché qu'une fois`);
  }

  if (!demo) { console.log('Données de référence prêtes.'); return; }

  // ---- Démo: un vendeur, un client, des produits ----
  const hash = (p) => bcrypt.hash(p, 12);
  let su = await pool.query('SELECT id FROM users WHERE email=$1', ['vendeur@geejmarket.sn']);
  let sellerId;
  if (!su.rowCount) {
    su = await pool.query(
      `INSERT INTO users(full_name,email,phone,password_hash,role) VALUES ('Moussa Fall','vendeur@geejmarket.sn','771110000',$1,'seller') RETURNING id`,
      [await hash('Vendeur#2026')]);
    const s = await pool.query(
      `INSERT INTO sellers(user_id,shop_name,description,phone,whatsapp,city) VALUES ($1,'GÉEJ Marché Central','Poissonnerie partenaire — produits de la pêche artisanale','771110000','221771110000','Dakar') RETURNING id`,
      [su.rows[0].id]);
    sellerId = s.rows[0].id;
  } else {
    sellerId = (await pool.query('SELECT id FROM sellers WHERE user_id=$1', [su.rows[0].id])).rows[0].id;
  }
  if (!(await pool.query('SELECT 1 FROM users WHERE email=$1', ['client@geejmarket.sn'])).rowCount) {
    await pool.query(
      `INSERT INTO users(full_name,email,phone,password_hash,role) VALUES ('Ousmane Diop','client@geejmarket.sn','771234567',$1,'client')`,
      [await hash('Client#2026')]);
  }

  const reg = async (n) => (await pool.query('SELECT id FROM regions WHERE name=$1', [n])).rows[0].id;
  const zones = [
    ['Dakar', 0.2, '2 à 4 h', 1, true], ['Thiès', 0.4, '4 à 6 h', 1.6, false],
    ['Saint-Louis', 0.7, '24 h', 3, false], ['Kaolack', 0.7, '24 h', 3, false],
  ];
  for (const [r, fee, eta, min, pickup] of zones) {
    await pool.query(
      `INSERT INTO delivery_zones(seller_id,region_id,commune,fee,eta_text,min_order,pickup_available,pickup_address,conditions)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,'Livraison en glacière isolée. Présence du client requise à la réception.')
       ON CONFLICT DO NOTHING`,
      [sellerId, await reg(r), fee, eta, min, pickup, pickup ? 'Marché Kermel, Dakar Plateau' : null]);
  }

  const cat = async (s) => (await pool.query('SELECT id FROM categories WHERE slug=$1', [s])).rows[0].id;
  // Prix (en π), stocks et textes de DÉMONSTRATION: à remplacer par les vrais produits du vendeur.
  const products = [
    ['poissons', 'Thiof (Bar) frais', 0.5, 'kg', null, 0.5, 0.5, 40, 'frais', '0°C à 4°C', 'Poisson frais de belle qualité, idéal pour les repas en famille. Chair ferme et savoureuse.', ['thiof']],
    ['poissons', 'Thon frais (tranches)', 0.7, 'kg', null, 0.5, 0.5, 25, 'frais', '0°C à 2°C', 'Tranches de thon frais, à griller ou à poêler.', ['thon']],
    ['poissons', 'Maquereau frais', 0.36, 'kg', null, 0.5, 0.5, 30, 'frais', '0°C à 4°C', 'Maquereaux entiers, parfaits grillés ou en sauce.', ['maquereau']],
    ['poissons', 'Sardines fraîches', 0.24, 'kg', null, 1, 1, 60, 'frais', '0°C à 4°C', 'Sardines entières, pêche du jour.', ['sardine']],
    ['crustaces', 'Crevettes fraîches', 0.8, 'paquet', '500 g', 1, 1, 20, 'frais', '0°C à 4°C', 'Crevettes fraîches, vendues par paquet de 500 g.', ['crevettes']],
    ['mollusques', 'Moules fraîches', 0.3, 'kg', null, 1, 1, 35, 'frais', '0°C à 4°C', 'Moules fraîches, à cuire rapidement après réception.', ['moules']],
    ['transformes', 'Poisson fumé (Thiof)', 0.7, 'kg', null, 0.5, 0.5, 18, 'fumé', 'Lieu frais et sec', 'Poisson fumé de façon traditionnelle.', ['poisson-fume']],
  ];
  for (const [c, name, price, unit, detail, step, min, stock, cond, storage, desc, imgs] of products) {
    if ((await pool.query('SELECT 1 FROM products WHERE seller_id=$1 AND name=$2', [sellerId, name])).rowCount) continue;
    const p = await pool.query(
      `INSERT INTO products(seller_id,category_id,name,description,price,unit,unit_detail,qty_step,min_qty,stock,condition,storage_info,available_from,orders_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_DATE,0) RETURNING id`,
      [sellerId, await cat(c), name, desc, price, unit, detail, step, min, stock, cond, storage]);
    let k = 0;
    for (const im of imgs) await pool.query('INSERT INTO product_images(product_id,url,sort_order) VALUES ($1,$2,$3)', [p.rows[0].id, `/img/products/${im}.jpg`, k++]);
  }
  console.log('Données de démonstration prêtes. Comptes: vendeur@geejmarket.sn / Vendeur#2026 ; client@geejmarket.sn / Client#2026');
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
