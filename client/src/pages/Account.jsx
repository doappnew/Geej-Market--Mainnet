import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { User, MapPin, Bell, LifeBuoy, Lock, LogOut, Store, ShieldCheck, ChevronRight, Wallet, Trash2, Link2 } from 'lucide-react';
import { api, setToken } from '../api.js';
import { dateFr, piFmt, phoneFmt, PAY_STATUS, PAY_METHOD, num } from '../util.js';
import { ScreenShell } from '../components/Layout.jsx';
import { Field, Spinner, ErrorBox, Empty, useAsync, Modal, PayBadge } from '../components/ui.jsx';
import { useAuth, useToast, useConfig } from '../state.jsx';
import { inPiBrowser, piAvailable, piLogin, waitForPi } from '../pi.js';

/* ---------- Connexion: compte Pi uniquement (pionniers) + accès équipe masqué ---------- */
export function PiLoginButton({ onDone, label = 'Se connecter avec mon compte Pi' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(piAvailable());
  useEffect(() => { if (ready) return undefined; let on = true; waitForPi(15000).then((ok) => on && setReady(ok)); return () => { on = false; }; }, [ready]);
  const go = async () => {
    setBusy(true);
    try { onDone(await piLogin(false)); } catch (e) { toast(e.message || 'Connexion Pi impossible.', 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <button className="btn btn-primary btn-block" onClick={go} disabled={busy}>{busy ? 'Connexion Pi…' : label}</button>
      {!ready && <div className="small center muted">Chargement de Pi Network… Si le bouton ne répond pas, ouvrez GÉEJ MARKET dans Pi Browser.</div>}
    </div>
  );
}

export function PiGate() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const after = async (res) => { await signIn(res); nav(loc.pathname === '/connexion' ? (loc.state?.from || '/') : loc.pathname, { replace: true }); };
  return (
    <div className="gate">
      <div className="gate-in stack">
        <h1>GÉEJ MARKET</h1>
        <p className="gate-sub">Le marché de la mer</p>
        <p className="muted">Connectez-vous avec votre compte Pi pour découvrir les produits, commander et payer en Pi (π).</p>
        <PiLoginButton onDone={after} />
        <div className="small muted center">Paiement uniquement en Pi (π).</div>
        <div className="small center"><Link to="/infos/conditions">Conditions d’utilisation</Link> · <Link to="/infos/confidentialite">Confidentialité</Link> · <Link to="/infos/legal">Mentions légales</Link></div>
      </div>
    </div>
  );
}

// Accès équipe (vendeur / administrateur): adresse e-mail + mot de passe. Non affiché dans les menus des pionniers.
export function StaffLogin() {
  const { signIn, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ identifier: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'seller' ? '/vendeur' : '/'} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await api.post('/api/auth/login', f);
      await signIn(res);
      nav(res.user.role === 'admin' ? '/admin' : res.user.role === 'seller' ? '/vendeur' : '/', { replace: true });
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <ScreenShell title="Accès équipe" back="/">
      <form className="card stack" style={{ maxWidth: 460, margin: '0 auto' }} onSubmit={submit} noValidate>
        <div className="small muted">Réservé au vendeur et à l’administrateur.</div>
        <Field label="E-mail" required><input autoComplete="username" value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} required /></Field>
        <Field label="Mot de passe" required><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        {err && <ErrorBox error={err} />}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Patientez…' : 'Se connecter'}</button>
      </form>
    </ScreenShell>
  );
}

/* ---------- Menu compte ---------- */
export function AccountHome() {
  const { user, ready, signOut } = useAuth();
  const nav = useNavigate();
  const unreadQ = useAsync(() => (user ? api.get('/api/me/notifications') : Promise.resolve(null)), [user?.id]);
  if (!ready) return <ScreenShell title="Mon compte"><Spinner /></ScreenShell>;
  if (!user) return <Navigate to="/connexion" replace />;
  return (
    <ScreenShell title="Mon compte" back="/">
      <div style={{ maxWidth: 620, margin: '0 auto' }} className="stack">
        <div className="card row"><div className="avatar">{user.full_name?.[0]?.toUpperCase()}</div>
          <div><b style={{ fontSize: 17 }}>{user.full_name}</b><div className="small muted">{user.phone ? phoneFmt(user.phone) : ''} {user.email ? `· ${user.email}` : ''}</div>{user.pi_username && <div className="small">π {user.pi_username}</div>}</div></div>
        <div className="menu">
          <Link to="/compte/infos"><User size={21} />Mes informations<ChevronRight className="chev" /></Link>
          <Link to="/compte/adresses"><MapPin size={21} />Mes adresses<ChevronRight className="chev" /></Link>
          <Link to="/compte/notifications"><Bell size={21} />Notifications{unreadQ.data?.unread > 0 && <span className="badge coral">{unreadQ.data.unread}</span>}<ChevronRight className="chev" /></Link>
          <Link to="/compte/paiements"><Wallet size={21} />Historique des paiements<ChevronRight className="chev" /></Link>
          <Link to="/compte/reclamations"><LifeBuoy size={21} />Réclamations et assistance<ChevronRight className="chev" /></Link>
          <Link to="/compte/securite"><Lock size={21} />Compte Pi et sécurité<ChevronRight className="chev" /></Link>
          {user.role === 'seller' && <Link to="/vendeur"><Store size={21} />Espace vendeur<ChevronRight className="chev" /></Link>}
          {user.role === 'admin' && <Link to="/admin"><ShieldCheck size={21} />Administration<ChevronRight className="chev" /></Link>}
          <button className="mi" onClick={() => { signOut(); nav('/'); }}><LogOut size={21} style={{ color: 'var(--danger)' }} />Se déconnecter</button>
        </div>
        <div className="small muted" style={{ textAlign: 'center' }}>Version {__APP_BUILD__}</div>
      </div>
    </ScreenShell>
  );
}

function Guard({ children, title, back = '/compte' }) {
  const { user, ready } = useAuth();
  if (!ready) return <ScreenShell title={title} back={back}><Spinner /></ScreenShell>;
  if (!user) return <Navigate to="/connexion" replace />;
  return <ScreenShell title={title} back={back}><div style={{ maxWidth: 620, margin: '0 auto' }}>{children}</div></ScreenShell>;
}

function Infos() {
  const { user, setUser } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ full_name: user.full_name, phone: phoneFmt(user.phone), email: user.email || '' });
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try { const r = await api.patch('/api/auth/me', { full_name: f.full_name, phone: f.phone || undefined, email: f.email || null }); setUser(r.user); toast('Informations enregistrées', 'ok'); } catch (e2) { setErr(e2); }
  };
  return (
    <form className="card stack" onSubmit={save}>
      <Field label="Nom et prénom"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
      <Field label="Téléphone"><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="E-mail"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      {err && <ErrorBox error={err} />}<button className="btn btn-primary">Enregistrer</button>
    </form>
  );
}

function Addresses() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const { data, loading } = useAsync(() => api.get('/api/me/addresses'), [tick]);
  const regs = useAsync(() => api.get('/api/geo/regions'), []);
  const [edit, setEdit] = useState(null);
  const del = async (a) => { if (confirm('Supprimer cette adresse ?')) { await api.del(`/api/me/addresses/${a.id}`); setTick(tick + 1); } };
  return (
    <div className="stack">
      {loading && <Spinner />}
      {data && !data.addresses.length && <Empty icon={MapPin} title="Aucune adresse enregistrée" />}
      {data?.addresses.map((a) => (
        <div className="card" key={a.id}>
          <div className="row between"><b>{a.label} {a.is_default && <span className="badge">Par défaut</span>}</b>
            <div className="row"><button className="btn btn-sm btn-ghost" onClick={() => setEdit(a)}>Modifier</button><button className="iconbtn" style={{ color: 'var(--danger)', width: 36, height: 36 }} aria-label="Supprimer" onClick={() => del(a)}><Trash2 size={18} /></button></div></div>
          <div className="small muted mt-s">{a.full_name} · {phoneFmt(a.phone)}<br />{a.address_line}{a.landmark ? ` (${a.landmark})` : ''}<br />{a.quartier}, {a.commune}, {a.department}, {a.region_name}</div>
        </div>
      ))}
      <button className="btn btn-primary" onClick={() => setEdit({})}>Ajouter une adresse</button>
      {edit && <AddressForm a={edit} regions={regs.data?.regions || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick(tick + 1); toast('Adresse enregistrée', 'ok'); }} />}
    </div>
  );
}
function AddressForm({ a, regions, onClose, onSaved }) {
  const { user } = useAuth();
  const [f, setF] = useState({ label: a.label || 'Domicile', full_name: a.full_name || user.full_name, phone: a.phone ? phoneFmt(a.phone) : phoneFmt(user.phone) || '', region_id: a.region_id ? String(a.region_id) : '', department: a.department || '', commune: a.commune || '', quartier: a.quartier || '', address_line: a.address_line || '', landmark: a.landmark || '', is_default: !!a.is_default });
  const [deps, setDeps] = useState([]); const [err, setErr] = useState(null);
  useEffect(() => { if (f.region_id) api.get(`/api/geo/departments?region_id=${f.region_id}`).then((r) => setDeps(r.departments)); }, [f.region_id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try { const body = { ...f, region_id: Number(f.region_id), landmark: f.landmark || null }; if (a.id) await api.put(`/api/me/addresses/${a.id}`, body); else await api.post('/api/me/addresses', body); onSaved(); } catch (e2) { setErr(e2); }
  };
  return (
    <Modal title={a.id ? 'Modifier l’adresse' : 'Nouvelle adresse'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="fgrid two">
          <Field label="Libellé"><input value={f.label} onChange={set('label')} /></Field><Field label="Nom complet"><input value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label="Téléphone"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Région"><select value={f.region_id} onChange={(e) => setF({ ...f, region_id: e.target.value, department: '' })} required><option value="">—</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Département"><select value={f.department} onChange={set('department')} required><option value="">—</option>{deps.map((d) => <option key={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Commune / Ville"><input value={f.commune} onChange={set('commune')} required /></Field>
          <Field label="Quartier"><input value={f.quartier} onChange={set('quartier')} required /></Field>
        </div>
        <Field label="Adresse détaillée"><input value={f.address_line} onChange={set('address_line')} required /></Field>
        <Field label="Point de repère"><input value={f.landmark} onChange={set('landmark')} /></Field>
        <label className="check"><input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} /> Adresse par défaut</label>
        {err && <ErrorBox error={err} />}
        <div className="row"><button type="button" className="btn btn-ghost grow" onClick={onClose}>Annuler</button><button className="btn btn-primary grow">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

function Notifications() {
  const [tick, setTick] = useState(0);
  const { data, loading } = useAsync(() => api.get('/api/me/notifications'), [tick]);
  useEffect(() => { if (data?.unread) api.post('/api/me/notifications/read', {}).catch(() => {}); }, [data?.unread]);
  const nav = useNavigate();
  return (
    <div className="stack">
      {loading && <Spinner />}
      {data && !data.notifications.length && <Empty icon={Bell} title="Aucune notification" />}
      {data?.notifications.map((n) => (
        <button key={n.id} className="card" style={{ textAlign: 'left', borderLeft: n.is_read ? undefined : '4px solid var(--turq)' }} onClick={() => n.order_id && nav(`/commandes/${n.order_id}`)}>
          <b>{n.title}</b><div className="small">{n.body}</div><div className="small muted">{dateFr(n.created_at)}</div>
        </button>
      ))}
      <div className="small muted center">Les notifications sont affichées dans l’application. L’envoi par e-mail ou WhatsApp n’est pas activé.</div>
    </div>
  );
}

function Complaints() {
  const [sp] = useSearchParams(); const toast = useToast();
  const [tick, setTick] = useState(0);
  const list = useAsync(() => api.get('/api/me/complaints'), [tick]);
  const orders = useAsync(() => api.get('/api/orders'), []);
  const [f, setF] = useState({ order_id: sp.get('commande') || '', subject: '', message: '' });
  const [err, setErr] = useState(null);
  const cfg = useConfig();
  const send = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/api/me/complaints', { order_id: f.order_id ? Number(f.order_id) : null, subject: f.subject, message: f.message }); setF({ order_id: '', subject: '', message: '' }); setTick(tick + 1); toast('Réclamation envoyée', 'ok'); } catch (e2) { setErr(e2); }
  };
  const ST = { ouverte: 'Ouverte', en_cours: 'En cours', resolue: 'Résolue', rejetee: 'Rejetée' };
  return (
    <div className="stack">
      <form className="card stack" onSubmit={send}>
        <h3>Nouvelle réclamation</h3>
        <Field label="Commande concernée"><select value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })}><option value="">Aucune / question générale</option>{orders.data?.orders.map((o) => <option key={o.id} value={o.id}>{o.order_no}</option>)}</select></Field>
        <Field label="Objet" required><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={120} required /></Field>
        <Field label="Message" required><textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={2000} required /></Field>
        {err && <ErrorBox error={err} />}<button className="btn btn-primary">Envoyer</button>
        {(cfg.support_phone || cfg.support_whatsapp) && <div className="small muted">Urgent ? {cfg.support_phone && <a href={`tel:${cfg.support_phone}`}>{cfg.support_phone}</a>}</div>}
      </form>
      {list.data?.complaints.map((c) => (
        <div className="card" key={c.id}><div className="row between"><b>{c.subject}</b><span className="badge">{ST[c.status]}</span></div>
          <div className="small muted">{c.order_no ? `${c.order_no} · ` : ''}{dateFr(c.created_at)}</div><p className="small">{c.message}</p>
          {c.response && <div className="notice small"><div><b>Réponse :</b> {c.response}</div></div>}</div>
      ))}
    </div>
  );
}

function Payments() {
  const { data, loading } = useAsync(() => api.get('/api/pay/payments'), []);
  return (
    <div className="stack">
      {loading && <Spinner />}
      {data && !data.payments.length && <Empty icon={Wallet} title="Aucun paiement" />}
      {data?.payments.map((p) => (
        <div className="card" key={p.id}><div className="row between"><b>{p.order_no}</b><PayBadge status={p.status === 'en_attente' ? 'non_paye' : p.status} /></div>
          <div className="small muted">{PAY_METHOD[p.method]} · {dateFr(p.paid_at || p.created_at)}</div>
          <div className="price">{piFmt(p.amount_pi)}</div>
          {p.txid && <div className="small muted" style={{ wordBreak: 'break-all' }}>Transaction : {p.txid}</div>}</div>
      ))}
    </div>
  );
}

function Security() {
  const { user, setUser } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '' }); const [err, setErr] = useState(null);
  const change = async (e) => {
    e.preventDefault(); setErr(null);
    try { const r = await api.post('/api/auth/change-password', f); setToken(r.token); setF({ current_password: '', new_password: '' }); toast('Mot de passe modifié', 'ok'); } catch (e2) { setErr(e2); }
  };
  const link = async () => { try { const r = await piLogin(true); setUser(r.user); toast('Compte Pi rattaché', 'ok'); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="stack">
      {user.role !== 'client' && <form className="card stack" onSubmit={change}>
        <h3>Changer le mot de passe</h3>
        <Field label="Mot de passe actuel"><input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum"><input type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        {err && <ErrorBox error={err} />}<button className="btn btn-primary">Modifier</button>
      </form>}
      <div className="card stack"><h3>Compte Pi Network</h3>
        {user.has_pi ? <div className="notice"><Link2 size={18} />Compte Pi rattaché : <b>{user.pi_username}</b></div> : <><div className="small muted">Rattachez votre compte Pi pour pouvoir payer en Pi (dans Pi Browser). GÉEJ MARKET ne demande jamais votre phrase secrète ni votre clé privée.</div><button className="btn btn-dark" onClick={link} disabled={!piAvailable()}>Rattacher mon compte Pi</button></>}
      </div>
    </div>
  );
}

export function AccountRoutes() {
  return (
    <Routes>
      <Route path="infos" element={<Guard title="Mes informations"><Infos /></Guard>} />
      <Route path="adresses" element={<Guard title="Mes adresses"><Addresses /></Guard>} />
      <Route path="notifications" element={<Guard title="Notifications"><Notifications /></Guard>} />
      <Route path="reclamations" element={<Guard title="Réclamations"><Complaints /></Guard>} />
      <Route path="paiements" element={<Guard title="Paiements"><Payments /></Guard>} />
      <Route path="securite" element={<Guard title="Sécurité"><Security /></Guard>} />
      <Route path="*" element={<Navigate to="/compte" replace />} />
    </Routes>
  );
}
