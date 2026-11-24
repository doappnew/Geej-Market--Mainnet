// Tests de bout en bout: vraie base PostgreSQL, vraie API. Seule l'API Pi est un faux serveur local (fixture de test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import sharp from 'sharp';

const BASE_URL = process.env.TEST_PG_URL || 'postgres://postgres@localhost:5433';
const DB = 'geej_test';
const ADMIN_PW = 'Admin#Geej2026';

let server, api, pool, piMock, piState;

const call = async (method, path, { token, body, form } = {}) => {
  const res = await fetch(api + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
// Fixture de test: simule le résultat d'un paiement Pi DÉJÀ confirmé, pour tester le travail du vendeur.
// Le vrai flux de paiement (approve/complete vérifiés côté serveur) est testé dans la section « Pi Network ».
const settle = async (orderId) => {
  await pool.query(`UPDATE orders SET payment_status='paye', status='nouvelle' WHERE id=$1`, [orderId]);
  await pool.query(`UPDATE payments SET status='paye', paid_at=now() WHERE order_id=$1`, [orderId]);
};
const login = async (identifier, password) => (await call('POST', '/api/auth/login', { body: { identifier, password } })).body.token;

const address = (regionId, extra = {}) => ({
  region_id: regionId, department: 'Dakar', commune: 'Dakar Plateau', quartier: 'HLM Grand Yoff', address_line: 'Villa 25, Rue 10', landmark: 'Près de la mosquée', ...extra,
});
const customer = { full_name: 'Ousmane Diop', phone: '77 123 45 67', email: '', pi_username: '' };
const orderBody = (items, regionId, extra = {}) => ({ items, customer, address: address(regionId), delivery_mode: 'domicile', consent_data: true, ...extra });

before(async () => {
  const root = new pg.Client({ connectionString: `${BASE_URL}/postgres` });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await root.query(`CREATE DATABASE ${DB}`);
  await root.end();
  process.env.DATABASE_URL = `${BASE_URL}/${DB}`;
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
  process.env.ADMIN_PASSWORD = ADMIN_PW;
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_PASSWORD_CLIENTS = '1';
  execFileSync('node', ['db/migrate.js'], { env: process.env, stdio: 'pipe' });
  execFileSync('node', ['db/seed.js', '--demo'], { env: process.env, stdio: 'pipe' });

  // Faux serveur Pi (fixture de test)
  piState = { payments: new Map(), me: new Map() };
  piMock = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const m = req.url.match(/^\/v2\/payments\/([^/]+)(?:\/(approve|complete))?$/);
    if (req.url === '/v2/me') {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      return piState.me.has(tok) ? send(200, piState.me.get(tok)) : send(401, { error: 'unauthorized' });
    }
    if (!m) return send(404, { error: 'not_found' });
    if (req.headers.authorization !== 'Key test-key') return send(401, { error: 'unauthorized' });
    const p = piState.payments.get(m[1]);
    if (!p) return send(404, { error: 'payment_not_found' });
    if (m[2] === 'approve') { p.status.developer_approved = true; return send(200, p); }
    if (m[2] === 'complete') { if (!p.transaction?.verified) return send(400, { error: 'transaction_not_verified' }); p.status.developer_completed = true; return send(200, p); }
    return send(200, p);
  });
  await new Promise((r) => piMock.listen(0, r));
  process.env.PI_API_BASE = `http://127.0.0.1:${piMock.address().port}`;
  process.env.PI_API_KEY = 'test-key';

  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  api = `http://127.0.0.1:${server.address().port}`;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  if (process.env.DB_SCHEMA) pool.on('connect', (c) => c.query(`SET search_path TO ${process.env.DB_SCHEMA}`));
});

after(async () => { server?.close(); piMock?.close(); await pool?.end(); const { pool: p } = await import('../src/db.js'); await p.end(); });

let clientTok, sellerTok, adminTok, regions = {}, products = {};

test('référentiel: 14 régions, 4 catégories, produits visibles', async () => {
  const r = await call('GET', '/api/geo/regions');
  assert.equal(r.body.regions.length, 14);
  for (const x of r.body.regions) regions[x.name] = x.id;
  assert.equal((await call('GET', '/api/categories')).body.categories.length, 4);
  const p = await call('GET', '/api/products');
  assert.equal(p.body.total, 7);
  for (const x of p.body.items) products[x.name] = x;
  const d = await call('GET', `/api/geo/departments?region_id=${regions.Dakar}`);
  assert.equal(d.body.departments.length, 5);
});

test('recherche insensible aux accents, filtres et injection SQL', async () => {
  assert.equal((await call('GET', '/api/products?search=poisson%20fume')).body.total, 1);
  assert.equal((await call('GET', '/api/products?category=crustaces')).body.total, 1);
  assert.equal((await call('GET', '/api/products?condition=fum%C3%A9')).body.total, 1);
  assert.equal((await call('GET', '/api/products?min_price=0.6&sort=price_asc')).body.items[0].name, 'Thon frais (tranches)');
  const inj = await call('GET', `/api/products?search=${encodeURIComponent("'; DROP TABLE users;--")}`);
  assert.equal(inj.status, 200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n >= 3, true);
});

test('connexion Pi seule: aucune connexion par mot de passe (équipe comprise); rôles équipe attribués par nom d\'utilisateur Pi', async () => {
  process.env.ALLOW_PASSWORD_CLIENTS = '0';
  process.env.ADMIN_PI_USERNAMES = '@Chef_Pi';
  process.env.SELLER_PI_USERNAMES = 'vendeur_pi, autre_vendeur';
  try {
    const reg = await call('POST', '/api/auth/register', { body: { full_name: 'Awa Ndiaye', phone: '+221 76 111 22 33', password: 'Motdepasse1', accept_terms: true } });
    assert.equal(reg.status, 403); assert.equal(reg.body.error?.code ?? reg.body.code, 'pi_only');
    for (const [id, pw] of [['admin@geejmarket.sn', ADMIN_PW], ['vendeur@geejmarket.sn', 'Vendeur#2026']]) {
      assert.equal((await call('POST', '/api/auth/login', { body: { identifier: id, password: pw } })).status, 403);
    }
    // équipe: rôle d'après le nom d'utilisateur Pi vérifié par Pi (/v2/me)
    piState.me.set('jeton-admin-pi-xxxxx', { uid: 'pi-uid-admin', username: 'chef_pi' });
    piState.me.set('jeton-vendeur-pi-xxxxx', { uid: 'pi-uid-vend', username: 'Vendeur_Pi' });
    piState.me.set('jeton-client-pi-xxxxx', { uid: 'pi-uid-cli', username: 'simple_client' });
    const ad = await call('POST', '/api/auth/pi', { body: { accessToken: 'jeton-admin-pi-xxxxx' } });
    assert.equal(ad.body.user.role, 'admin');
    assert.equal((await call('GET', '/api/admin/stats', { token: ad.body.token })).status, 200);
    // l'administrateur gère lui-même la boutique: création d'un produit sans compte vendeur
    assert.ok(ad.body.user.seller_id);
    const cat = (await call('GET', '/api/categories')).body.categories[0];
    const np = await call('POST', '/api/seller/products', { token: ad.body.token, body: { category_id: cat.id, name: 'Produit admin test', description: 'x', price: 0.25, unit: 'kg', qty_step: 0.5, min_qty: 0.5, stock: 10, condition: 'frais', is_active: true } });
    assert.equal(np.status, 201);
    assert.equal((await call('GET', '/api/admin/products', { token: ad.body.token })).body.products.some((x) => x.name === 'Produit admin test'), true);
    const vd = await call('POST', '/api/auth/pi', { body: { accessToken: 'jeton-vendeur-pi-xxxxx' } });
    assert.equal(vd.body.user.role, 'seller');
    assert.equal((await call('GET', '/api/seller/dashboard', { token: vd.body.token })).status, 200);
    assert.equal((await call('GET', '/api/admin/stats', { token: vd.body.token })).status, 403);
    const cl = await call('POST', '/api/auth/pi', { body: { accessToken: 'jeton-client-pi-xxxxx' } });
    assert.equal(cl.body.user.role, 'client');
    assert.equal((await call('GET', '/api/admin/stats', { token: cl.body.token })).status, 403);
    // retrait de la liste => retour au rôle client à la connexion suivante
    process.env.ADMIN_PI_USERNAMES = '';
    const ad2 = await call('POST', '/api/auth/pi', { body: { accessToken: 'jeton-admin-pi-xxxxx' } });
    assert.equal(ad2.body.user.role, 'client');
  } finally { process.env.ALLOW_PASSWORD_CLIENTS = '1'; process.env.ADMIN_PI_USERNAMES = ''; process.env.SELLER_PI_USERNAMES = ''; }
});

test('inscription, validation et connexion', async () => {
  assert.equal((await call('POST', '/api/auth/register', { body: { full_name: 'A', phone: '123', password: 'x', accept_terms: true } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { full_name: 'Awa Ndiaye', phone: '+221 76 555 44 33', password: 'Motdepasse1', accept_terms: false } })).status, 400);
  const ok = await call('POST', '/api/auth/register', { body: { full_name: 'Awa Ndiaye', phone: '+221 76 555 44 33', password: 'Motdepasse1', accept_terms: true } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.phone, '765554433');
  assert.equal((await call('POST', '/api/auth/register', { body: { full_name: 'Awa 2', phone: '765554433', password: 'Motdepasse1', accept_terms: true } })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { body: { identifier: '765554433', password: 'mauvais' } })).status, 401);
  clientTok = await login('76 555 44 33', 'Motdepasse1');
  assert.ok(clientTok);
  sellerTok = await login('vendeur@geejmarket.sn', 'Vendeur#2026');
  adminTok = await login('admin@geejmarket.sn', ADMIN_PW);
  assert.ok(sellerTok && adminTok);
});

test('contrôle des accès par rôle', async () => {
  assert.equal((await call('GET', '/api/cart')).status, 401);
  assert.equal((await call('GET', '/api/seller/dashboard', { token: clientTok })).status, 403);
  assert.equal((await call('GET', '/api/admin/stats', { token: sellerTok })).status, 403);
  assert.equal((await call('GET', '/api/admin/stats', { token: adminTok })).status, 200);
  assert.equal((await call('GET', '/api/me/addresses', { token: 'forged.token.value' })).status, 401);
});

test('panier: pas de vente, minimum, stock, fusion invité', async () => {
  const thiof = products['Thiof (Bar) frais'].id;
  assert.equal((await call('PUT', '/api/cart/items', { token: clientTok, body: { product_id: thiof, quantity: 0.3 } })).status, 422);
  assert.equal((await call('PUT', '/api/cart/items', { token: clientTok, body: { product_id: thiof, quantity: 0.75 } })).status, 422);
  const ok = await call('PUT', '/api/cart/items', { token: clientTok, body: { product_id: thiof, quantity: 1.5 } });
  assert.equal(ok.body.subtotal, 0.75);
  const clamp = await call('PUT', '/api/cart/items', { token: clientTok, body: { product_id: thiof, quantity: 500 } });
  assert.equal(clamp.body.clamped, true);
  assert.equal(clamp.body.quantity, 40);
  const merged = await call('POST', '/api/cart/merge', { token: clientTok, body: { items: [{ product_id: products['Crevettes fraîches'].id, quantity: 2 }, { product_id: 9999, quantity: 1 }] } });
  assert.equal(merged.body.skipped.length, 1);
  assert.equal(merged.body.items.length, 2);
  await call('PUT', '/api/cart/items', { token: clientTok, body: { product_id: thiof, quantity: 0 } });
  assert.equal((await call('GET', '/api/cart', { token: clientTok })).body.items.length, 1);
  await call('DELETE', '/api/cart', { token: clientTok });
});

test('devis de livraison: zone desservie, non desservie, minimum', async () => {
  const items = [{ product_id: products['Thiof (Bar) frais'].id, quantity: 2 }, { product_id: products['Crevettes fraîches'].id, quantity: 2 }];
  const q = await call('POST', '/api/checkout/quote', { body: { items, region_id: regions.Dakar, mode: 'domicile' } });
  assert.equal(q.body.subtotal, 2.6);
  assert.equal(q.body.delivery_fee, 0.2);
  assert.equal(q.body.total, 2.8);
  assert.equal(q.body.can_order, true);
  const n = await call('POST', '/api/checkout/quote', { body: { items, region_id: regions.Louga, mode: 'domicile' } });
  assert.equal(n.body.can_order, false);
  assert.match(n.body.sellers[0].reason, /ne livre pas/);
  const small = await call('POST', '/api/checkout/quote', { body: { items: [{ product_id: products['Sardines fraîches'].id, quantity: 1 }], region_id: regions.Dakar } });
  assert.match(small.body.sellers[0].reason, /minimum/i);
  const pick = await call('POST', '/api/checkout/quote', { body: { items, region_id: regions.Dakar, mode: 'retrait_vente' } });
  assert.equal(pick.body.delivery_fee, 0);
  const pickBad = await call('POST', '/api/checkout/quote', { body: { items, region_id: regions['Thiès'], mode: 'retrait_vente' } });
  assert.equal(pickBad.body.can_order, false);
});

let order1;
test('commande: création, numéro unique, stock, historique, notifications', async () => {
  const items = [{ product_id: products['Thiof (Bar) frais'].id, quantity: 2 }, { product_id: products['Crevettes fraîches'].id, quantity: 2 }];
  assert.equal((await call('POST', '/api/orders', { body: orderBody(items, regions.Dakar) })).status, 401);
  assert.equal((await call('POST', '/api/orders', { token: clientTok, body: orderBody(items, regions.Dakar, { consent_data: false }) })).status, 400);
  assert.equal((await call('POST', '/api/orders', { token: clientTok, body: orderBody(items, regions.Louga) })).status, 422);
  const before = (await pool.query('SELECT stock FROM products WHERE id=$1', [items[0].product_id])).rows[0].stock;
  const r = await call('POST', '/api/orders', { token: clientTok, body: orderBody(items, regions.Dakar, { save_address: true }) });
  assert.equal(r.status, 201);
  order1 = r.body.orders[0];
  assert.match(order1.order_no, /^GJM-\d{4}-\d{6}$/);
  assert.equal(order1.total, 2.8);
  assert.equal(order1.status, 'en_attente_paiement'); // jamais transmise au vendeur avant paiement
  assert.equal((await call('GET', '/api/seller/orders', { token: sellerTok })).body.orders.some((x) => x.id === order1.id), false);
  assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1', [items[0].product_id])).rows[0].stock, before - 2);
  const det = await call('GET', `/api/orders/${order1.id}`, { token: clientTok });
  assert.equal(det.body.order.payment_status, 'non_paye'); // jamais payé automatiquement
  assert.equal(det.body.order.history.length, 1);
  assert.equal(det.body.order.items.length, 2);
  assert.equal((await call('GET', '/api/me/notifications', { token: clientTok })).body.unread >= 1, true);
  assert.equal((await call('GET', '/api/me/addresses', { token: clientTok })).body.addresses.length, 1);
  await settle(order1.id);
  const sd = await call('GET', '/api/seller/dashboard', { token: sellerTok });
  assert.equal(sd.body.orders.nouvelle, 1);
  // Stock insuffisant
  const big = await call('POST', '/api/orders', { token: clientTok, body: orderBody([{ product_id: items[0].product_id, quantity: 999 }], regions.Dakar) });
  assert.equal(big.status, 422);
});

test('isolation entre clients et entre vendeurs', async () => {
  const other = (await call('POST', '/api/auth/register', { body: { full_name: 'Autre Client', phone: '781112233', password: 'Motdepasse1', accept_terms: true } })).body.token;
  assert.equal((await call('GET', `/api/orders/${order1.id}`, { token: other })).status, 404);
  assert.equal((await call('POST', `/api/orders/${order1.id}/cancel`, { token: other, body: {} })).status, 404);
  // second vendeur
  const s2 = await call('POST', '/api/admin/sellers', { token: adminTok, body: { full_name: 'Pêcheur Joal', email: 'joal@geejmarket.sn', phone: '772223344', password: 'Joal#2026pw', shop_name: 'Pêcheurs de Joal', city: 'Joal' } });
  assert.equal(s2.status, 201);
  const s2tok = await login('joal@geejmarket.sn', 'Joal#2026pw');
  assert.equal((await call('GET', `/api/seller/orders/${order1.id}`, { token: s2tok })).status, 404);
  assert.equal((await call('POST', `/api/seller/orders/${order1.id}/accept`, { token: s2tok })).status, 404);
  assert.equal((await call('PATCH', `/api/seller/products/${products['Thiof (Bar) frais'].id}`, { token: s2tok, body: { stock: 0 } })).status, 404);
  assert.equal((await call('GET', '/api/seller/orders', { token: s2tok })).body.orders.length, 0);
});

test('vendeur: workflow des statuts, transitions invalides, montants verrouillés après paiement', async () => {
  const id = order1.id;
  const d = await call('GET', `/api/seller/orders/${id}`, { token: sellerTok });
  assert.equal(d.body.order.customer_phone, '771234567');
  assert.equal(d.body.order.quartier, 'HLM Grand Yoff');
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'livree' } })).status, 409);
  assert.equal((await call('POST', `/api/seller/orders/${id}/reject`, { token: sellerTok, body: { reason: '' } })).status, 400);
  assert.equal((await call('POST', `/api/seller/orders/${id}/accept`, { token: sellerTok })).status, 200);
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'en_preparation' } })).status, 200);
  assert.equal((await call('PATCH', `/api/seller/orders/${id}/amounts`, { token: sellerTok, body: { final_total: 1 } })).status, 409); // payée: montant verrouillé
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'prete' } })).status, 200);
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'en_livraison', driver_name: 'Ibrahima', driver_phone: '77 000 11 22' } })).status, 200);
  // Le client ne peut plus annuler
  assert.equal((await call('POST', `/api/orders/${id}/cancel`, { token: clientTok, body: {} })).status, 409);
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'livree' } })).status, 200);
  assert.equal((await call('POST', `/api/seller/orders/${id}/mark-paid`, { token: sellerTok })).status, 404); // plus d'encaissement manuel
  const c = await call('GET', `/api/orders/${id}`, { token: clientTok });
  assert.equal(c.body.order.status, 'livree');
  assert.equal(c.body.order.payment_status, 'paye');
  assert.equal(c.body.order.final_total, null);
  assert.ok(c.body.order.history.length >= 6);
  const sd = await call('GET', '/api/seller/dashboard', { token: sellerTok });
  assert.equal(sd.body.revenue_paid, 2.8);
  assert.equal((await call('POST', `/api/seller/orders/${id}/status`, { token: sellerTok, body: { status: 'annulee', note: 'x' } })).status, 409);
});

test("l'historique de commande conserve le prix d'origine après modification du produit", async () => {
  const pid = products['Thiof (Bar) frais'].id;
  assert.equal((await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 1.9998 } })).status, 200);
  const c = await call('GET', `/api/orders/${order1.id}`, { token: clientTok });
  assert.equal(c.body.order.items.find((i) => i.product_name.startsWith('Thiof')).unit_price, 0.5);
  await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 0.5 } });
  assert.equal((await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 0.2, promo_price: 0.3 } })).status, 422);
});

test('refus vendeur avec motif remet le stock; annulation client', async () => {
  const pid = products['Moules fraîches'].id;
  const stock = async () => Number((await pool.query('SELECT stock FROM products WHERE id=$1', [pid])).rows[0].stock);
  const s0 = await stock();
  const o = (await call('POST', '/api/orders', { token: clientTok, body: orderBody([{ product_id: pid, quantity: 4 }, { product_id: products['Poisson fumé (Thiof)'].id, quantity: 1 }], regions.Dakar) })).body.orders[0];
  await settle(o.id);
  assert.equal(await stock(), s0 - 4);
  assert.equal((await call('POST', `/api/seller/orders/${o.id}/reject`, { token: sellerTok, body: { reason: 'Rupture imprévue' } })).status, 200);
  assert.equal(await stock(), s0);
  const c = await call('GET', `/api/orders/${o.id}`, { token: clientTok });
  assert.equal(c.body.order.status, 'annulee');
  assert.equal(c.body.order.reject_reason, 'Rupture imprévue');
  assert.equal(c.body.order.payment_status, 'paye'); // le paiement reste à rembourser, rien n'est remboursé automatiquement
  assert.ok((await call('GET', '/api/me/notifications', { token: adminTok })).body.notifications.some((x) => x.type === 'refund_due'));
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/refund`, { token: adminTok, body: { note: 'Remboursé manuellement' } })).status, 200);
  const o2 = (await call('POST', '/api/orders', { token: clientTok, body: orderBody([{ product_id: pid, quantity: 6 }], regions.Dakar) })).body.orders[0];
  assert.equal((await call('POST', `/api/orders/${o2.id}/cancel`, { token: clientTok, body: { reason: 'Changement de plan' } })).status, 200);
  assert.equal(await stock(), s0);
  const n = (await call('GET', '/api/me/notifications', { token: clientTok })).body.notifications.map((x) => x.type);
  assert.ok(n.includes('order_status'));
});

test('commande multi-vendeurs: une commande par vendeur', async () => {
  const s2tok = await login('joal@geejmarket.sn', 'Joal#2026pw');
  const cats = (await call('GET', '/api/categories')).body.categories;
  const np = await call('POST', '/api/seller/products', { token: s2tok, body: { category_id: cats[2].id, name: 'Huîtres de Joal', price: 0.6, unit: 'lot', unit_detail: '12 pièces', qty_step: 1, min_qty: 1, stock: 10, condition: 'frais' } });
  assert.equal(np.status, 201);
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#18A6A3' } }).png().toBuffer();
  const fd = new FormData(); fd.append('images', new Blob([png], { type: 'image/png' }), 'x.png');
  const up = await call('POST', `/api/seller/products/${np.body.id}/images`, { token: s2tok, form: fd });
  assert.equal(up.status, 201);
  assert.match(up.body.urls[0], /^\/uploads\/.+\.webp$/);
  const bad = new FormData(); bad.append('images', new Blob(['pas une image'], { type: 'image/png' }), 'x.png');
  assert.equal((await call('POST', `/api/seller/products/${np.body.id}/images`, { token: s2tok, form: bad })).status, 400);
  assert.equal((await call('POST', '/api/seller/zones', { token: s2tok, body: { region_id: regions.Dakar, fee: 0.3, eta_text: '3 h', min_order: 0 } })).status, 201);
  const r = await call('POST', '/api/orders', { token: clientTok, body: orderBody([{ product_id: np.body.id, quantity: 2 }, { product_id: products['Maquereau frais'].id, quantity: 3 }], regions.Dakar) });
  assert.equal(r.status, 201);
  assert.equal(r.body.orders.length, 2);
  assert.deepEqual(r.body.orders.map((o) => o.total).sort((a, b) => a - b), [1.28, 1.5]);
  // l'image est bien servie
  const img = await fetch(api + up.body.urls[0]);
  assert.equal(img.status, 200);
});

test('vendeur: zones de livraison configurables', async () => {
  const z = await call('POST', '/api/seller/zones', { token: sellerTok, body: { region_id: regions.Louga, fee: 0.8, eta_text: '24 h', min_order: 0 } });
  assert.equal(z.status, 201);
  const items = [{ product_id: products['Thon frais (tranches)'].id, quantity: 2 }];
  assert.equal((await call('POST', '/api/checkout/quote', { body: { items, region_id: regions.Louga } })).body.delivery_fee, 0.8);
  await call('PUT', `/api/seller/zones/${z.body.id}`, { token: sellerTok, body: { region_id: regions.Louga, fee: 0.8, eta_text: '24 h', min_order: 0, is_active: false } });
  assert.equal((await call('POST', '/api/checkout/quote', { body: { items, region_id: regions.Louga } })).body.can_order, false);
  assert.equal((await call('POST', '/api/seller/zones', { token: sellerTok, body: { region_id: regions.Louga, fee: 1, eta_text: 'x' } })).status, 409);
});

test('réclamations, administration, suspension et journal', async () => {
  const c = await call('POST', '/api/me/complaints', { token: clientTok, body: { order_id: order1.id, subject: 'Poids incorrect', message: 'Il manquait 200 g.' } });
  assert.equal(c.status, 201);
  const list = await call('GET', '/api/admin/complaints', { token: adminTok });
  assert.equal(list.body.complaints[0].subject, 'Poids incorrect');
  assert.equal((await call('PATCH', `/api/admin/complaints/${c.body.id}`, { token: adminTok, body: { status: 'resolue', response: 'Geste commercial accordé.' } })).status, 200);
  assert.equal((await call('GET', '/api/me/complaints', { token: clientTok })).body.complaints[0].status, 'resolue');
  const st = await call('GET', '/api/admin/stats', { token: adminTok });
  assert.ok(st.body.orders.total >= 5);
  // suspension: le jeton existant cesse immédiatement de fonctionner
  const victim = (await call('POST', '/api/auth/register', { body: { full_name: 'À suspendre', phone: '705550000', password: 'Motdepasse1', accept_terms: true } })).body;
  assert.equal((await call('GET', '/api/me/addresses', { token: victim.token })).status, 200);
  assert.equal((await call('PATCH', `/api/admin/users/${victim.user.id}`, { token: adminTok, body: { is_active: false } })).status, 200);
  assert.equal((await call('GET', '/api/me/addresses', { token: victim.token })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { identifier: '705550000', password: 'Motdepasse1' } })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/users/${(await call('GET', '/api/auth/me', { token: adminTok })).body.user.id}`, { token: adminTok, body: { is_active: false } })).status, 409);
  // catégories
  const cat = await call('POST', '/api/admin/categories', { token: adminTok, body: { name: 'Algues', slug: 'algues', sort_order: 9 } });
  assert.equal(cat.status, 201);
  assert.equal((await call('DELETE', `/api/admin/categories/${cat.body.id}`, { token: adminTok })).status, 200);
  assert.equal((await call('DELETE', `/api/admin/categories/${(await call('GET', '/api/categories')).body.categories[0].id}`, { token: adminTok })).status, 409);
  // journal
  const logs = await call('GET', '/api/admin/audit', { token: adminTok });
  const actions = logs.body.logs.map((l) => l.action);
  for (const a of ['order.create', 'order.status', 'user.suspend', 'auth.login']) assert.ok(actions.includes(a), a);
  assert.ok(!JSON.stringify(logs.body).includes('Motdepasse1'));
});

// ---------------- Pi Network ----------------
let piTok, piOrder, piPay;
const PI_TOKEN = 'pi-access-token-abcdef';
test('montants: 7 décimales maximum, jamais négatifs', async () => {
  const pid = products['Thiof (Bar) frais'].id;
  assert.equal((await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 0.12345678 } })).status, 400);
  assert.equal((await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: -1 } })).status, 400);
  assert.equal((await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 0.1234567 } })).status, 200);
  await call('PATCH', `/api/seller/products/${pid}`, { token: sellerTok, body: { price: 0.5 } });
});

test('Pi: connexion vérifiée côté serveur (/v2/me), refus d’un jeton invalide', async () => {
  assert.equal((await call('POST', '/api/auth/pi', { body: { accessToken: 'jeton-invalide-xxxxx' } })).status, 401);
  piState.me.set(PI_TOKEN, { uid: 'pi-uid-1', username: 'pionnier_sn' });
  const r = await call('POST', '/api/auth/pi', { body: { accessToken: PI_TOKEN } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.pi_username, 'pionnier_sn');
  piTok = r.body.token;
  const again = await call('POST', '/api/auth/pi', { body: { accessToken: PI_TOKEN } });
  assert.equal(again.body.user.id, r.body.user.id);
});

test('Pi: tous les montants en π; commande et paiement distincts', async () => {
  const items = [{ product_id: products['Thon frais (tranches)'].id, quantity: 2 }];
  const cfg = (await call('GET', '/api/config')).body;
  assert.equal(cfg.currency, 'PI');
  assert.equal(cfg.pi_payment_enabled, true);
  assert.equal('pi_rate_fcfa' in cfg, false); // aucun taux de conversion: Pi est la seule monnaie
  // commander ne demande pas de compte Pi; mais un client sans compte Pi ne peut pas PAYER
  const nopi = await call('POST', '/api/orders', { token: clientTok, body: orderBody(items, regions.Dakar) });
  assert.equal(nopi.status, 201);
  assert.equal((await call('POST', `/api/pay/orders/${nopi.body.orders[0].id}/pi-payment`, { token: clientTok })).status, 409);
  const r = await call('POST', '/api/orders', { token: piTok, body: orderBody(items, regions.Dakar) });
  assert.equal(r.status, 201);
  piOrder = r.body.orders[0];
  assert.equal(piOrder.status, 'en_attente_paiement');
  assert.equal((await call('GET', '/api/seller/orders?status=en_attente_paiement', { token: sellerTok })).body.orders.length, 0); // invisible tant que non payée
  const pp = await call('POST', `/api/pay/orders/${piOrder.id}/pi-payment`, { token: piTok });
  assert.equal(pp.status, 200);
  assert.equal(pp.body.amount, 1.6);
  piPay = pp.body;
});

test('Pi: approbation et finalisation vérifiées côté serveur, idempotentes', async () => {
  const PID = 'PAY_123';
  const make = (over = {}) => ({
    identifier: PID, user_uid: 'pi-uid-1', network: 'Pi Network', amount: piPay.amount, memo: piPay.memo, metadata: piPay.metadata,
    status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null, ...over,
  });
  // montant falsifié -> refus
  piState.payments.set(PID, make({ amount: 0.0001 }));
  assert.equal((await call('POST', '/api/pay/pi/approve', { token: piTok, body: { paymentId: PID } })).status, 409);
  // paiement d'un autre réseau (Testnet) -> refus Mainnet
  piState.payments.set(PID, make({ network: 'Pi Testnet' }));
  const wn = await call('POST', '/api/pay/pi/approve', { token: piTok, body: { paymentId: PID } });
  assert.equal(wn.status, 409);
  assert.equal(piState.payments.get(PID).status.developer_approved, false);
  // autre utilisateur -> refus
  piState.payments.set(PID, make());
  assert.equal((await call('POST', '/api/pay/pi/approve', { token: clientTok, body: { paymentId: PID } })).status, 403);
  // paiement inconnu de Pi
  assert.equal((await call('POST', '/api/pay/pi/approve', { token: piTok, body: { paymentId: 'PAY_INCONNU' } })).status, 404);
  // OK
  assert.equal((await call('POST', '/api/pay/pi/approve', { token: piTok, body: { paymentId: PID } })).status, 200);
  assert.equal(piState.payments.get(PID).status.developer_approved, true);
  assert.equal((await call('GET', `/api/orders/${piOrder.id}`, { token: piTok })).body.order.payment_status, 'en_cours');
  // /complete refusé par Pi (transaction non vérifiée) -> aucune confirmation, commande NON payée
  assert.notEqual((await call('POST', '/api/pay/pi/complete', { token: piTok, body: { paymentId: PID, txid: 'abcdef123456' } })).status, 200);
  assert.equal((await call('GET', `/api/orders/${piOrder.id}`, { token: piTok })).body.order.payment_status, 'en_cours');
  // transaction vérifiée -> payée
  const p = piState.payments.get(PID); p.status.transaction_verified = true; p.transaction = { txid: 'abcdef123456', verified: true };
  const done = await call('POST', '/api/pay/pi/complete', { token: piTok, body: { paymentId: PID, txid: 'abcdef123456' } });
  assert.equal(done.status, 200);
  const o = (await call('GET', `/api/orders/${piOrder.id}`, { token: piTok })).body.order;
  assert.equal(o.payment_status, 'paye');
  assert.equal(o.status, 'nouvelle');
  assert.equal(o.payments.find((x) => x.method === 'pi').status, 'paye');
  // idempotent
  assert.equal((await call('POST', '/api/pay/pi/complete', { token: piTok, body: { paymentId: PID, txid: 'abcdef123456' } })).body.already, true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM pi_transactions WHERE pi_payment_id=$1', [PID])).rows[0].n, 1);
  // le vendeur la voit maintenant, mais ne peut pas la marquer payée à la main ni changer le montant
  assert.equal((await call('GET', '/api/seller/orders?status=nouvelle', { token: sellerTok })).body.orders.some((x) => x.id === piOrder.id), true);
  assert.equal((await call('POST', `/api/seller/orders/${piOrder.id}/mark-paid`, { token: sellerTok })).status, 404); // l'encaissement manuel n'existe plus
  assert.equal((await call('PATCH', `/api/seller/orders/${piOrder.id}/amounts`, { token: sellerTok, body: { final_total: 1 } })).status, 409);
  assert.equal((await call('GET', '/api/pay/payments', { token: piTok })).body.payments[0].txid, 'abcdef123456');
  assert.equal((await call('POST', `/api/orders/${piOrder.id}/cancel`, { token: piTok, body: {} })).status, 409); // payée: pas d'annulation en ligne
});

test('reçu de paiement: uniquement si payé, code de contrôle vérifiable par le vendeur', async () => {
  // piOrder est payée (test précédent). Le client reçoit un reçu avec txid et code.
  const rc = await call('GET', `/api/orders/${piOrder.id}/receipt`, { token: piTok });
  assert.equal(rc.status, 200);
  assert.equal(rc.body.receipt.txid, 'abcdef123456');
  assert.match(rc.body.receipt.code, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  // un autre client ne peut pas lire ce reçu
  assert.equal((await call('GET', `/api/orders/${piOrder.id}/receipt`, { token: clientTok })).status, 404);
  // une commande non payée n'a pas de reçu
  const items = [{ product_id: products['Thon frais (tranches)'].id, quantity: 2 }]; // 1,4 π: au-dessus du minimum de la zone
  const unpaid = (await call('POST', '/api/orders', { token: piTok, body: orderBody(items, regions.Dakar) })).body.orders[0];
  assert.equal((await call('GET', `/api/orders/${unpaid.id}/receipt`, { token: piTok })).status, 409);
  // le vendeur vérifie à la livraison
  const ok = await call('POST', '/api/seller/receipts/verify', { token: sellerTok, body: { order_no: rc.body.receipt.order_no, code: rc.body.receipt.code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.valid, true);
  assert.equal('code' in ok.body.receipt, false);
  assert.equal((await call('POST', '/api/seller/receipts/verify', { token: sellerTok, body: { order_no: rc.body.receipt.order_no, code: 'AAAAA-BBBBB' } })).status, 404);
  assert.equal((await call('POST', '/api/seller/receipts/verify', { token: clientTok, body: { order_no: rc.body.receipt.order_no, code: rc.body.receipt.code } })).status, 403);
  // un reçu fabriqué pour une commande non payée est refusé
  assert.equal((await call('POST', '/api/seller/receipts/verify', { token: sellerTok, body: { order_no: unpaid.order_no, code: rc.body.receipt.code } })).status, 404);
  assert.equal((await call('POST', `/api/admin/orders/${piOrder.id}/refund`, { token: adminTok, body: { note: 'Remboursement manuel' } })).status, 200);
  // après remboursement, le reçu n'est plus valable
  assert.equal((await call('GET', `/api/orders/${piOrder.id}/receipt`, { token: piTok })).status, 409);
  assert.equal((await call('POST', '/api/seller/receipts/verify', { token: sellerTok, body: { order_no: rc.body.receipt.order_no, code: rc.body.receipt.code } })).status, 404);
});

test('schéma dédié (DB_SCHEMA): les tables restent hors de « public »', { skip: !process.env.DB_SCHEMA }, async () => {
  const s = process.env.DB_SCHEMA;
  const inSchema = (await pool.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname = $1`, [s])).rows[0].n;
  const inPublic = (await pool.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
  assert.ok(inSchema > 20);
  assert.equal(inPublic, 0);
});
