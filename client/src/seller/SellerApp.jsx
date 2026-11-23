import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num, dateFr, CONDITIONS, UNITS, STATUS, phoneFmt } from '../util.js';
import { BackOffice, Kpi, Bars } from '../components/BackOffice.jsx';
import { Field, Spinner, ErrorBox, StatusBadge, PayBadge, Switch, useAsync, Empty } from '../components/ui.jsx';
import OrderPanel from '../components/OrderPanel.jsx';
import ZonesManager from '../components/ZonesManager.jsx';
import { useToast } from '../state.jsx';

const NAV = [['/vendeur', 'Tableau de bord', true], ['/vendeur/commandes', 'Commandes'], ['/vendeur/produits', 'Produits & stocks'], ['/vendeur/zones', 'Livraison'], ['/vendeur/recus', 'Vérifier un reçu'], ['/vendeur/boutique', 'Ma boutique']];

export default function SellerApp() {
  return (
    <BackOffice role="seller" title="Espace vendeur" nav={NAV}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="commandes" element={<Orders />} />
        <Route path="commandes/:id" element={<OrderPage />} />
        <Route path="produits" element={<Products />} />
        <Route path="produits/nouveau" element={<ProductForm />} />
        <Route path="produits/:id" element={<ProductForm />} />
        <Route path="zones" element={<ZonesManager />} />
        <Route path="boutique" element={<Shop />} />
        <Route path="recus" element={<VerifyReceipt />} />
      </Routes>
    </BackOffice>
  );
}

function Dashboard() {
  const { data, loading, error } = useAsync(() => api.get('/api/seller/dashboard'), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const o = data.orders; const n = (k) => o[k] || 0;
  return (
    <>
      <h1>Tableau de bord</h1>
      <div className="kpis">
        <Kpi label="Nouvelles commandes" value={n('nouvelle')} accent />
        <Kpi label="En attente de confirmation" value={n('en_attente_confirmation')} />
        <Kpi label="Confirmées" value={n('confirmee')} />
        <Kpi label="En préparation" value={n('en_preparation') + n('prete')} />
        <Kpi label="En livraison" value={n('en_livraison')} />
        <Kpi label="Terminées" value={n('livree')} />
        <Kpi label="Produits disponibles" value={data.products.available} />
        <Kpi label="Ruptures de stock" value={data.products.out_of_stock} warn={data.products.out_of_stock > 0} />
      </div>
      <div className="kpis"><Kpi label="Chiffre d’affaires (commandes payées)" value={piFmt(data.revenue_paid)} accent /></div>
      <div className="cols">
        <div className="card"><h3>Commandes — 7 derniers jours</h3><Bars data={data.last7} /></div>
        <div className="card"><h3>Produits les plus commandés</h3>
          {!data.top_products.length && <div className="muted small">Pas encore de ventes.</div>}
          {data.top_products.map((p) => <div className="sumrow" key={p.product_name}><span>{p.product_name} <span className="muted small">({num(p.qty)})</span></span><b>{piFmt(p.amount)}</b></div>)}</div>
      </div>
      {n('nouvelle') > 0 && <Link className="btn btn-coral mt" to="/vendeur/commandes?statut=nouvelle">Traiter les {n('nouvelle')} nouvelle(s) commande(s)</Link>}
    </>
  );
}

function Orders() {
  const nav = useNavigate();
  const [status, setStatus] = useState(new URLSearchParams(location.search).get('statut') || '');
  const { data, loading, error } = useAsync(() => api.get(`/api/seller/orders${status ? `?status=${status}` : ''}`), [status]);
  return (
    <>
      <h1>Commandes</h1>
      <div className="chips mb"><button className={`chip ${!status ? 'on' : ''}`} onClick={() => setStatus('')}>Toutes</button>{Object.entries(STATUS).filter(([k]) => k !== 'en_attente_paiement').map(([k, [l]]) => <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && !data.orders.length && <Empty title="Aucune commande" />}
      {data?.orders.length > 0 && <div className="tablewrap"><table className="t"><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Zone</th><th>Montant</th><th>Statut</th><th>Paiement</th></tr></thead>
        <tbody>{data.orders.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/vendeur/commandes/${o.id}`)}><td><b>{o.order_no}</b></td><td>{dateFr(o.created_at)}</td><td>{o.customer_name}<div className="small muted">{phoneFmt(o.customer_phone)}</div></td><td>{o.commune}</td><td>{piFmt(o.final_total ?? o.total)}</td><td><StatusBadge status={o.status} /></td><td><PayBadge status={o.payment_status} /></td></tr>)}</tbody></table></div>}
    </>
  );
}

function OrderPage() {
  const { id } = useParams();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useAsync(() => api.get(`/api/seller/orders/${id}`), [id, tick]);
  return (<><Link to="/vendeur/commandes" className="small">← Commandes</Link><div className="mt-s" />{loading && !data && <Spinner />}{error && <ErrorBox error={error} />}{data && <OrderPanel o={data.order} role="seller" reload={() => setTick((x) => x + 1)} />}</>);
}

function Products() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useAsync(() => api.get('/api/seller/products'), [tick]);
  const patch = async (p, body) => { try { await api.patch(`/api/seller/products/${p.id}`, body); setTick(tick + 1); } catch (e) { toast(e.message, 'bad'); } };
  const del = async (p) => { if (confirm(`Supprimer « ${p.name} » ? (les commandes passées sont conservées)`)) { await api.del(`/api/seller/products/${p.id}`); setTick(tick + 1); } };
  return (
    <>
      <div className="row between mb"><h1 style={{ margin: 0 }}>Produits &amp; stocks</h1><Link to="/vendeur/produits/nouveau" className="btn btn-primary">Ajouter un produit</Link></div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && !data.products.length && <Empty title="Aucun produit">Ajoutez votre premier produit pour l’afficher dans la boutique.</Empty>}
      {data?.products.length > 0 && <div className="tablewrap"><table className="t"><thead><tr><th /><th>Produit</th><th>Prix</th><th>Stock</th><th>Actif</th><th /></tr></thead>
        <tbody>{data.products.map((p) => (
          <tr key={p.id}><td>{p.images[0] ? <img className="thumb" src={p.images[0]} alt="" /> : <div className="thumb" />}</td>
            <td><b>{p.name}</b><div className="small muted">{p.category_name} · {p.condition}</div></td>
            <td>{piFmt(p.price)} / {p.unit}{p.is_promo && <div className="badge coral">Promo {piFmt(p.promo_price)}</div>}</td>
            <td><StockEdit p={p} onSave={(v) => patch(p, { stock: v })} /></td>
            <td><Switch checked={p.is_active} onChange={(v) => patch(p, { is_active: v })} label={`Activer ${p.name}`} /></td>
            <td><div className="row"><Link className="btn btn-sm btn-ghost" to={`/vendeur/produits/${p.id}`}>Modifier</Link><button className="btn btn-sm btn-danger" aria-label="Supprimer" onClick={() => del(p)}><Trash2 size={15} /></button></div></td></tr>
        ))}</tbody></table></div>}
    </>
  );
}
function StockEdit({ p, onSave }) {
  const [v, setV] = useState(String(p.stock));
  useEffect(() => setV(String(p.stock)), [p.stock]);
  const out = p.stock < p.min_qty;
  return <div className="row" style={{ gap: 6 }}><input style={{ width: 80, minHeight: 36 }} className="input" type="number" min="0" step="any" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== Number(p.stock) && v !== '' && onSave(Number(v))} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Stock de ${p.name}`} /><span className="small muted">{p.unit}</span>{out && <span className="badge red">Rupture</span>}</div>;
}

function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate(); const toast = useToast();
  const cats = useAsync(() => api.get('/api/categories'), []);
  const [f, setF] = useState(null);
  const [images, setImages] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!id) { setF({ category_id: '', name: '', description: '', price: '', promo_price: '', unit: 'kg', unit_detail: '', qty_step: 0.5, min_qty: 0.5, stock: '', condition: 'frais', storage_info: '', available_from: new Date().toISOString().slice(0, 10), prepared_on: '', traceability: '', is_active: true, is_featured: false }); return; }
    api.get('/api/seller/products').then((r) => {
      const p = r.products.find((x) => String(x.id) === id);
      if (p) setF({ ...p, promo_price: p.promo_price ?? '', unit_detail: p.unit_detail || '', storage_info: p.storage_info || '', available_from: p.available_from || '', prepared_on: p.prepared_on || '', traceability: p.traceability || '' });
    });
    api.get(`/api/seller/products/${id}/images`).then((r) => setImages(r.images));
  }, [id]);

  if (!f) return <Spinner />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const unitPreset = (u) => setF({ ...f, unit: u, qty_step: u === 'kg' ? 0.5 : 1, min_qty: u === 'kg' ? 0.5 : 1 });

  const save = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = { category_id: Number(f.category_id), name: f.name, description: f.description, price: Number(f.price), promo_price: f.promo_price === '' ? null : Number(f.promo_price), unit: f.unit, unit_detail: f.unit_detail || null, qty_step: Number(f.qty_step), min_qty: Number(f.min_qty), stock: Number(f.stock), condition: f.condition, storage_info: f.storage_info || null, available_from: f.available_from || null, prepared_on: f.prepared_on || null, traceability: f.traceability || null, is_active: !!f.is_active, is_featured: !!f.is_featured };
    try {
      let pid = id;
      if (id) await api.put(`/api/seller/products/${id}`, body); else pid = (await api.post('/api/seller/products', body)).id;
      if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append('images', x)); await api.upload(`/api/seller/products/${pid}/images`, fd); }
      toast('Produit enregistré', 'ok'); nav('/vendeur/produits');
    } catch (e2) { setErr(e2); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };
  const delImg = async (im) => { await api.del(`/api/seller/products/${id}/images/${im.id}`); setImages(images.filter((x) => x.id !== im.id)); };

  return (
    <form onSubmit={save} className="stack" style={{ maxWidth: 820 }}>
      <h1>{id ? 'Modifier le produit' : 'Nouveau produit'}</h1>
      {err && <ErrorBox error={err} />}
      <div className="card">
        <div className="fgrid two">
          <Field label="Nom du produit" required><input value={f.name} onChange={set('name')} required maxLength={120} /></Field>
          <Field label="Catégorie" required><select value={f.category_id} onChange={set('category_id')} required><option value="">—</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        <div className="mt-s"><Field label="Description"><textarea value={f.description} onChange={set('description')} maxLength={2000} /></Field></div>
      </div>
      <div className="card">
        <h3>Prix et vente</h3>
        <div className="fgrid three">
          <Field label="Prix (π)" required><input type="number" min="0" step="any" value={f.price} onChange={set('price')} required /></Field>
          <Field label="Prix promo (π)" hint="Vide = pas de promotion"><input type="number" min="0" step="any" value={f.promo_price} onChange={set('promo_price')} /></Field>
          <Field label="Unité de vente" required><select value={UNITS.includes(f.unit) ? f.unit : 'autre'} onChange={(e) => (e.target.value === 'autre' ? setF({ ...f, unit: '' }) : unitPreset(e.target.value))}>{UNITS.map((u) => <option key={u}>{u}</option>)}<option value="autre">Autre…</option></select></Field>
          {!UNITS.includes(f.unit) && <Field label="Unité personnalisée" required><input value={f.unit} onChange={set('unit')} required /></Field>}
          <Field label="Détail de l’unité" hint="Ex : 500 g, 12 pièces"><input value={f.unit_detail} onChange={set('unit_detail')} /></Field>
          <Field label="Pas de quantité" hint="Ex : 0,5 pour vendre par demi-kg"><input type="number" min="0.001" step="any" value={f.qty_step} onChange={set('qty_step')} required /></Field>
          <Field label="Quantité minimale"><input type="number" min="0.001" step="any" value={f.min_qty} onChange={set('min_qty')} required /></Field>
          <Field label={`Stock disponible (${f.unit || 'unité'})`} required><input type="number" min="0" step="any" value={f.stock} onChange={set('stock')} required /></Field>
        </div>
      </div>
      <div className="card">
        <h3>Fraîcheur et traçabilité</h3>
        <div className="fgrid two">
          <Field label="État"><select value={f.condition} onChange={set('condition')}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Conservation" hint="Ex : 0°C à 4°C"><input value={f.storage_info} onChange={set('storage_info')} /></Field>
          <Field label="Disponible à partir du"><input type="date" value={f.available_from} onChange={set('available_from')} /></Field>
          <Field label="Date de préparation / pêche"><input type="date" value={f.prepared_on} onChange={set('prepared_on')} /></Field>
        </div>
        <div className="mt-s"><Field label="Traçabilité (origine, pêcheur, port…)"><input value={f.traceability} onChange={set('traceability')} /></Field></div>
      </div>
      <div className="card">
        <h3>Photographies</h3>
        <p className="small muted">Photos réelles du produit (JPEG, PNG ou WebP). Elles sont optimisées automatiquement. La première photo est l’image principale.</p>
        <div className="imggrid">
          {images.map((im) => <div className="im" key={im.id}><img src={im.url} alt="" /><button type="button" aria-label="Supprimer la photo" onClick={() => delImg(im)}><Trash2 size={14} /></button></div>)}
          {files.map((x, i) => <div className="im" key={i}><img src={URL.createObjectURL(x)} alt="" /><button type="button" aria-label="Retirer" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>)}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files)].slice(0, 6)); e.target.value = ''; }} />
        <button type="button" className="btn btn-ghost mt-s" onClick={() => fileRef.current.click()}><Upload size={16} /> Ajouter des photos</button>
      </div>
      <div className="card row wrap">
        <label className="row"><Switch checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Produit actif" /> Produit actif (visible et commandable)</label>
        <label className="row"><Switch checked={!!f.is_featured} onChange={(v) => setF({ ...f, is_featured: v })} label="Sélection du vendeur" /> Sélection du vendeur (page d’accueil)</label>
      </div>
      <div className="row"><Link to="/vendeur/produits" className="btn btn-ghost">Annuler</Link><button className="btn btn-primary grow" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le produit'}</button></div>
    </form>
  );
}

function Shop() {
  const toast = useToast();
  const { data } = useAsync(() => api.get('/api/seller/profile'), []);
  const [f, setF] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ ...data.seller, phone: phoneFmt(data.seller.phone), description: data.seller.description || '', city: data.seller.city || '' }); }, [data]);
  if (!f) return <Spinner />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setErr(null); try { await api.put('/api/seller/profile', { shop_name: f.shop_name, description: f.description, city: f.city, phone: f.phone }); toast('Boutique mise à jour', 'ok'); } catch (e2) { setErr(e2); } };
  return (
    <form className="card stack" style={{ maxWidth: 620 }} onSubmit={save}>
      <h1>Ma boutique</h1>
      <Field label="Nom de la boutique" required><input value={f.shop_name} onChange={set('shop_name')} required /></Field>
      <Field label="Description"><textarea value={f.description} onChange={set('description')} maxLength={500} /></Field>
      <div className="fgrid two"><Field label="Ville"><input value={f.city} onChange={set('city')} /></Field><Field label="Téléphone" required><input inputMode="tel" value={f.phone} onChange={set('phone')} required /></Field></div>
      {err && <ErrorBox error={err} />}<button className="btn btn-primary">Enregistrer</button>
    </form>
  );
}


function VerifyReceipt() {
  const [f, setF] = useState({ order_no: '', code: '' }); const [res, setRes] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setErr(null); setRes(null); setBusy(true);
    try { setRes((await api.post('/api/seller/receipts/verify', { order_no: f.order_no.trim(), code: f.code.trim() })).receipt); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>Vérifier un reçu</h1>
      <form className="card stack" onSubmit={go}>
        <div className="small muted">À la livraison, le client présente son reçu de paiement. Saisissez le numéro de commande et le code de contrôle inscrits sur le reçu.</div>
        <Field label="Numéro de commande" required><input value={f.order_no} onChange={(e) => setF({ ...f, order_no: e.target.value })} placeholder="GJM-2026-000001" required /></Field>
        <Field label="Code de contrôle" required><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="XXXXX-XXXXX" required /></Field>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier'}</button>
      </form>
      {err && <div className="notice warn">Reçu invalide ou introuvable. Ne remettez pas la commande.</div>}
      {res && (
        <div className="card stack">
          <div className="notice"><b>Reçu valide : paiement en Pi confirmé.</b></div>
          <div className="sumrow"><span>Commande</span><b>{res.order_no}</b></div>
          <div className="sumrow"><span>Client</span><b>{res.customer_name}</b></div>
          <div className="sumrow"><span>Statut</span><b>{STATUS[res.status]?.[0] || res.status}</b></div>
          {res.items.map((i, k) => <div className="sumrow" key={k}><span>{i.product_name}</span><b>{num(i.quantity)} {i.unit}</b></div>)}
          <div className="sumrow total"><span>Total payé</span><span className="price">{piFmt(res.final_total ?? res.total)}</span></div>
          {res.status === 'livree' && <div className="notice warn">Cette commande est déjà marquée livrée.</div>}
        </div>
      )}
    </div>
  );
}
