import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { piFmt, dateFr, STATUS, phoneFmt } from '../util.js';
import { BackOffice, Kpi, Bars } from '../components/BackOffice.jsx';
import { Field, Spinner, ErrorBox, StatusBadge, PayBadge, Switch, useAsync, Empty, Modal } from '../components/ui.jsx';
import OrderPanel from '../components/OrderPanel.jsx';
import ZonesManager from '../components/ZonesManager.jsx';
import { useToast } from '../state.jsx';

const NAV = [['/admin', 'Statistiques', true], ['/admin/commandes', 'Commandes'], ['/admin/produits', 'Produits & stocks'], ['/admin/categories', 'Catégories'], ['/admin/vendeurs', 'Vendeurs'], ['/admin/utilisateurs', 'Utilisateurs'], ['/admin/zones', 'Livraison'], ['/admin/reclamations', 'Réclamations'], ['/admin/parametres', 'Paramètres'], ['/admin/journal', 'Journal']];

export default function AdminApp() {
  return (
    <BackOffice role="admin" title="Administration" nav={NAV}>
      <Routes>
        <Route index element={<Stats />} />
        <Route path="commandes" element={<Orders />} />
        <Route path="commandes/:id" element={<OrderPage />} />
        <Route path="produits" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="vendeurs" element={<Sellers />} />
        <Route path="utilisateurs" element={<Users />} />
        <Route path="zones" element={<ZonesManager admin />} />
        <Route path="reclamations" element={<Complaints />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="journal" element={<Audit />} />
      </Routes>
    </BackOffice>
  );
}

function Stats() {
  const { data, loading, error } = useAsync(() => api.get('/api/admin/stats'), []);
  if (loading) return <Spinner />; if (error) return <ErrorBox error={error} />;
  const s = (k) => data.by_status.find((x) => x.status === k)?.n || 0;
  return (
    <>
      <h1>Statistiques générales</h1>
      <div className="kpis">
        <Kpi label="Commandes (total)" value={data.orders.total} accent /><Kpi label="Commandes aujourd’hui" value={data.orders.today} />
        <Kpi label="Chiffre d’affaires encaissé" value={piFmt(data.money.paid_revenue)} accent /><Kpi label="Volume commandé (hors annulées)" value={piFmt(data.money.gross)} />
        <Kpi label="Clients" value={data.users.clients} /><Kpi label="Vendeurs" value={data.users.sellers} />
        <Kpi label="Produits disponibles" value={`${data.products.available} / ${data.products.total}`} /><Kpi label="Ruptures de stock" value={data.products.out_of_stock} warn={data.products.out_of_stock > 0} />
        <Kpi label="Réclamations ouvertes" value={data.complaints.open} warn={data.complaints.open > 0} /><Kpi label="Comptes suspendus" value={data.users.suspended} />
        <Kpi label="Nouvelles commandes" value={s('nouvelle')} /><Kpi label="En livraison" value={s('en_livraison')} />
      </div>
      <div className="card"><h3>Commandes — 14 derniers jours</h3><Bars data={data.daily} /></div>
      <div className="card mt"><h3>Répartition par statut</h3><div className="row wrap">{data.by_status.map((x) => <span key={x.status} className="row"><StatusBadge status={x.status} /> <b>{x.n}</b></span>)}</div></div>
    </>
  );
}

function Orders() {
  const nav = useNavigate();
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const { data, loading, error } = useAsync(() => api.get(`/api/admin/orders?page=${page}${status ? `&status=${status}` : ''}${q ? `&search=${encodeURIComponent(q)}` : ''}`), [status, q, page]);
  return (
    <>
      <h1>Commandes</h1>
      <div className="row wrap mb"><input className="input" style={{ maxWidth: 280 }} placeholder="N°, nom ou téléphone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 240 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Tous les statuts</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>N°</th><th>Date</th><th>Vendeur</th><th>Client</th><th>Montant</th><th>Statut</th><th>Paiement</th></tr></thead>
        <tbody>{data.orders.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/admin/commandes/${o.id}`)}><td><b>{o.order_no}</b></td><td>{dateFr(o.created_at)}</td><td>{o.shop_name}</td><td>{o.customer_name}<div className="small muted">{phoneFmt(o.customer_phone)}</div></td><td>{piFmt(o.final_total ?? o.total)}</td><td><StatusBadge status={o.status} /></td><td><PayBadge status={o.payment_status} /></td></tr>)}</tbody></table></div>}
      <Pager page={page} setPage={setPage} more={data?.orders.length === 30} />
    </>
  );
}
const Pager = ({ page, setPage, more }) => (<div className="pager"><button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button><span className="small">Page {page}</span><button className="btn btn-sm btn-ghost" disabled={!more} onClick={() => setPage(page + 1)}>Suivant</button></div>);

function OrderPage() {
  const { id } = useParams(); const [tick, setTick] = useState(0);
  const { data, loading, error } = useAsync(() => api.get(`/api/admin/orders/${id}`), [id, tick]);
  return (<><Link to="/admin/commandes" className="small">← Commandes</Link><div className="mt-s" />{loading && !data && <Spinner />}{error && <ErrorBox error={error} />}{data && <OrderPanel o={data.order} role="admin" reload={() => setTick((x) => x + 1)} />}</>);
}

function Products() {
  const toast = useToast(); const [tick, setTick] = useState(0); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const { data, loading, error } = useAsync(() => api.get(`/api/admin/products?page=${page}${q ? `&search=${encodeURIComponent(q)}` : ''}`), [tick, q, page]);
  const patch = async (p, b) => { try { await api.patch(`/api/admin/products/${p.id}`, b); setTick(tick + 1); } catch (e) { toast(e.message, 'bad'); } };
  const del = async (p) => { if (confirm(`Supprimer « ${p.name} » ?`)) { await api.del(`/api/admin/products/${p.id}`); setTick(tick + 1); } };
  return (
    <>
      <h1>Produits et stocks</h1>
      <input className="input mb" style={{ maxWidth: 300 }} placeholder="Rechercher un produit…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>Produit</th><th>Vendeur</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Sélection</th><th>Actif</th><th /></tr></thead>
        <tbody>{data.products.map((p) => <tr key={p.id}><td><div className="row">{p.images[0] ? <img className="thumb" src={p.images[0]} alt="" /> : <div className="thumb" />}<b>{p.name}</b></div></td><td>{p.shop_name}</td><td>{p.category_name}</td><td>{piFmt(p.price)}</td>
          <td><AdminStock p={p} onSave={(v) => patch(p, { stock: v })} /></td>
          <td><Switch checked={p.is_featured} onChange={(v) => patch(p, { is_featured: v })} label="Sélection" /></td><td><Switch checked={p.is_active} onChange={(v) => patch(p, { is_active: v })} label="Actif" /></td>
          <td><button className="btn btn-sm btn-danger" onClick={() => del(p)}>Suppr.</button></td></tr>)}</tbody></table></div>}
      <Pager page={page} setPage={setPage} more={data?.products.length === 30} />
    </>
  );
}
function AdminStock({ p, onSave }) {
  const [v, setV] = useState(String(p.stock)); useEffect(() => setV(String(p.stock)), [p.stock]);
  return <div className="row" style={{ gap: 6 }}><input className="input" style={{ width: 80, minHeight: 36 }} type="number" min="0" step="any" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== '' && Number(v) !== Number(p.stock) && onSave(Number(v))} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Stock ${p.name}`} /><span className="small muted">{p.unit}</span></div>;
}

function Categories() {
  const toast = useToast(); const [tick, setTick] = useState(0); const [edit, setEdit] = useState(null);
  const { data, loading, error } = useAsync(() => api.get('/api/admin/categories'), [tick]);
  const del = async (c) => { try { if (confirm(`Supprimer « ${c.name} » ?`)) { await api.del(`/api/admin/categories/${c.id}`); setTick(tick + 1); } } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <div className="row between mb"><h1 style={{ margin: 0 }}>Catégories</h1><button className="btn btn-primary" onClick={() => setEdit({ name: '', slug: '', image_url: '', sort_order: 0, is_active: true })}>Ajouter</button></div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>Nom</th><th>Identifiant</th><th>Produits</th><th>Ordre</th><th>Active</th><th /></tr></thead>
        <tbody>{data.categories.map((c) => <tr key={c.id}><td><b>{c.name}</b></td><td>{c.slug}</td><td>{c.products}</td><td>{c.sort_order}</td><td>{c.is_active ? <span className="badge green">Oui</span> : <span className="badge grey">Non</span>}</td><td><div className="row"><button className="btn btn-sm btn-ghost" onClick={() => setEdit(c)}>Modifier</button><button className="btn btn-sm btn-danger" onClick={() => del(c)}>Suppr.</button></div></td></tr>)}</tbody></table></div>}
      {edit && <CatForm c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick(tick + 1); }} />}
    </>
  );
}
function CatForm({ c, onClose, onSaved }) {
  const [f, setF] = useState({ ...c, image_url: c.image_url || '' }); const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => { e.preventDefault(); setErr(null); const b = { name: f.name, slug: f.slug, image_url: f.image_url || null, sort_order: Number(f.sort_order), is_active: !!f.is_active }; try { if (c.id) await api.put(`/api/admin/categories/${c.id}`, b); else await api.post('/api/admin/categories', b); onSaved(); } catch (e2) { setErr(e2); } };
  return (<Modal title={c.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose}><form className="stack" onSubmit={save}>
    <Field label="Nom" required><input value={f.name} onChange={set('name')} required /></Field><Field label="Identifiant (slug)" hint="minuscules, chiffres, tirets" required><input value={f.slug} onChange={set('slug')} required pattern="[a-z0-9-]{2,40}" /></Field>
    <Field label="Image (URL)"><input value={f.image_url} onChange={set('image_url')} placeholder="/img/cats/…" /></Field><Field label="Ordre d’affichage"><input type="number" value={f.sort_order} onChange={set('sort_order')} /></Field>
    <label className="check"><input type="checkbox" checked={!!f.is_active} onChange={set('is_active')} /> Active</label>{err && <ErrorBox error={err} />}
    <div className="row"><button type="button" className="btn btn-ghost grow" onClick={onClose}>Annuler</button><button className="btn btn-primary grow">Enregistrer</button></div></form></Modal>);
}

function Sellers() {
  const toast = useToast(); const [tick, setTick] = useState(0); const [add, setAdd] = useState(false);
  const { data, loading, error } = useAsync(() => api.get('/api/admin/sellers'), [tick]);
  const toggle = async (s, v) => { try { await api.patch(`/api/admin/sellers/${s.id}`, { is_active: v }); setTick(tick + 1); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <div className="row between mb"><h1 style={{ margin: 0 }}>Vendeurs</h1><button className="btn btn-primary" onClick={() => setAdd(true)}>Créer un vendeur</button></div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>Boutique</th><th>Responsable</th><th>Produits</th><th>Commandes</th><th>Actif</th></tr></thead>
        <tbody>{data.sellers.map((s) => <tr key={s.id}><td><b>{s.shop_name}</b><div className="small muted">{s.city}</div></td><td>{s.full_name}<div className="small muted">{s.email} · {phoneFmt(s.phone)}</div></td><td>{s.products}</td><td>{s.orders}</td><td><Switch checked={s.is_active} onChange={(v) => toggle(s, v)} label="Vendeur actif" /></td></tr>)}</tbody></table></div>}
      {add && <SellerForm onClose={() => setAdd(false)} onSaved={() => { setAdd(false); setTick(tick + 1); toast('Vendeur créé', 'ok'); }} />}
    </>
  );
}
function SellerForm({ onClose, onSaved }) {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', shop_name: '', city: '' }); const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setErr(null); try { await api.post('/api/admin/sellers', { ...f, city: f.city || undefined }); onSaved(); } catch (e2) { setErr(e2); } };
  return (<Modal title="Nouveau vendeur" onClose={onClose}><form className="stack" onSubmit={save}>
    <div className="fgrid two"><Field label="Nom de la boutique" required><input value={f.shop_name} onChange={set('shop_name')} required /></Field><Field label="Ville"><input value={f.city} onChange={set('city')} /></Field>
      <Field label="Responsable" required><input value={f.full_name} onChange={set('full_name')} required /></Field><Field label="Téléphone" required><input inputMode="tel" value={f.phone} onChange={set('phone')} required /></Field>
      <Field label="E-mail (identifiant)" required><input type="email" value={f.email} onChange={set('email')} required /></Field><Field label="Mot de passe provisoire" hint="8 caractères min. À communiquer au vendeur"><input type="text" value={f.password} onChange={set('password')} required minLength={8} /></Field></div>
    {err && <ErrorBox error={err} />}<div className="row"><button type="button" className="btn btn-ghost grow" onClick={onClose}>Annuler</button><button className="btn btn-primary grow">Créer</button></div></form></Modal>);
}

function Users() {
  const toast = useToast(); const [tick, setTick] = useState(0); const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [page, setPage] = useState(1); const [pw, setPw] = useState(null);
  const { data, loading, error } = useAsync(() => api.get(`/api/admin/users?page=${page}${role ? `&role=${role}` : ''}${q ? `&search=${encodeURIComponent(q)}` : ''}`), [tick, q, role, page]);
  const toggle = async (u, v) => { try { await api.patch(`/api/admin/users/${u.id}`, { is_active: v }); setTick(tick + 1); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <h1>Utilisateurs</h1>
      <div className="row wrap mb"><input className="input" style={{ maxWidth: 280 }} placeholder="Nom, téléphone, e-mail, pseudo Pi…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 180 }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">Tous les rôles</option><option value="client">Clients</option><option value="seller">Vendeurs</option><option value="admin">Admins</option></select></div>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>Nom</th><th>Contact</th><th>Rôle</th><th>Inscrit le</th><th>Actif</th><th /></tr></thead>
        <tbody>{data.users.map((u) => <tr key={u.id}><td><b>{u.full_name}</b>{u.pi_username && <div className="small">π {u.pi_username}</div>}</td><td className="small">{phoneFmt(u.phone)}<br />{u.email}</td><td><span className="badge">{u.role}</span></td><td>{dateFr(u.created_at)}</td>
          <td><Switch checked={u.is_active} onChange={(v) => toggle(u, v)} label="Compte actif" /></td><td><button className="btn btn-sm btn-ghost" onClick={() => setPw(u)}>Mot de passe</button></td></tr>)}</tbody></table></div>}
      <Pager page={page} setPage={setPage} more={data?.users.length === 30} />
      {pw && <PwModal u={pw} onClose={() => setPw(null)} />}
    </>
  );
}
function PwModal({ u, onClose }) {
  const toast = useToast(); const [p, setP] = useState(''); const [err, setErr] = useState(null);
  const go = async () => { try { await api.post(`/api/admin/users/${u.id}/reset-password`, { new_password: p }); toast('Mot de passe réinitialisé (sessions fermées)', 'ok'); onClose(); } catch (e) { setErr(e); } };
  return (<Modal title={`Réinitialiser — ${u.full_name}`} onClose={onClose}><div className="stack"><Field label="Nouveau mot de passe provisoire" hint="8 caractères min."><input value={p} onChange={(e) => setP(e.target.value)} /></Field>{err && <ErrorBox error={err} />}<button className="btn btn-primary" disabled={p.length < 8} onClick={go}>Réinitialiser</button></div></Modal>);
}

function Complaints() {
  const toast = useToast(); const [tick, setTick] = useState(0); const [sel, setSel] = useState(null);
  const { data, loading, error } = useAsync(() => api.get('/api/admin/complaints'), [tick]);
  const ST = { ouverte: ['Ouverte', 'amber'], en_cours: ['En cours', 'blue'], resolue: ['Résolue', 'green'], rejetee: ['Rejetée', 'grey'] };
  return (
    <>
      <h1>Réclamations</h1>{loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && !data.complaints.length && <Empty title="Aucune réclamation" />}
      <div className="stack">{data?.complaints.map((c) => (
        <div className="card" key={c.id}><div className="row between wrap"><b>{c.subject}</b><span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span></div>
          <div className="small muted">{c.full_name} · {phoneFmt(c.phone)}{c.order_no ? ` · ${c.order_no}` : ''} · {dateFr(c.created_at)}</div><p>{c.message}</p>
          {c.response && <div className="notice small"><div><b>Réponse :</b> {c.response}</div></div>}
          <button className="btn btn-sm btn-ghost mt-s" onClick={() => setSel(c)}>Traiter</button></div>))}</div>
      {sel && <Respond c={sel} onClose={() => setSel(null)} onSaved={() => { setSel(null); setTick(tick + 1); toast('Réclamation mise à jour', 'ok'); }} />}
    </>
  );
}
function Respond({ c, onClose, onSaved }) {
  const [status, setStatus] = useState(c.status === 'ouverte' ? 'en_cours' : c.status); const [response, setResponse] = useState(c.response || ''); const [err, setErr] = useState(null);
  const go = async () => { try { await api.patch(`/api/admin/complaints/${c.id}`, { status, response: response || undefined }); onSaved(); } catch (e) { setErr(e); } };
  return (<Modal title={c.subject} onClose={onClose}><div className="stack"><Field label="Statut"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ouverte">Ouverte</option><option value="en_cours">En cours</option><option value="resolue">Résolue</option><option value="rejetee">Rejetée</option></select></Field>
    <Field label="Réponse au client"><textarea value={response} onChange={(e) => setResponse(e.target.value)} maxLength={2000} /></Field>{err && <ErrorBox error={err} />}<button className="btn btn-primary" onClick={go}>Enregistrer (le client est notifié)</button></div></Modal>);
}

function Settings() {
  const toast = useToast(); const { data, loading } = useAsync(() => api.get('/api/admin/settings'), []);
  const [f, setF] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ support_phone: data.settings.support_phone || '', support_whatsapp: data.settings.support_whatsapp || '' }); }, [data]);
  if (loading || !f) return <Spinner />;
  const save = async (e) => { e.preventDefault(); setErr(null); try { await api.put('/api/admin/settings', f); toast('Paramètres enregistrés', 'ok'); } catch (e2) { setErr(e2); } };
  return (
    <form className="card stack" style={{ maxWidth: 620 }} onSubmit={save}>
      <h1>Paramètres</h1>
      <Field label="Téléphone du service client"><input value={f.support_phone} onChange={(e) => setF({ ...f, support_phone: e.target.value })} /></Field>
      <Field label="WhatsApp du service client"><input value={f.support_whatsapp} onChange={(e) => setF({ ...f, support_whatsapp: e.target.value })} /></Field>
      {err && <ErrorBox error={err} />}<button className="btn btn-primary">Enregistrer</button>
    </form>
  );
}

function Audit() {
  const [page, setPage] = useState(1); const [q, setQ] = useState('');
  const { data, loading, error } = useAsync(() => api.get(`/api/admin/audit?page=${page}${q ? `&action=${encodeURIComponent(q)}` : ''}`), [page, q]);
  return (
    <>
      <h1>Journal des opérations</h1>
      <input className="input mb" style={{ maxWidth: 300 }} placeholder="Filtrer (ex : order, user, pi)…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && <div className="tablewrap"><table className="t"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Objet</th><th>Détails</th></tr></thead>
        <tbody>{data.logs.map((l) => <tr key={l.id}><td className="small">{dateFr(l.created_at)}</td><td>{l.actor || <span className="muted">—</span>}</td><td><b>{l.action}</b></td><td className="small">{l.entity}{l.entity_id ? ` #${l.entity_id}` : ''}</td><td className="small muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{l.details ? JSON.stringify(l.details) : ''}</td></tr>)}</tbody></table></div>}
      <Pager page={page} setPage={setPage} more={data?.logs.length === 30} />
    </>
  );
}
