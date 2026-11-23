// Détail d'une commande côté vendeur/admin (affichage + actions)
import { useState } from 'react';
import { Phone, MessageCircle, MapPin, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num, dateFr, MODES, PAY_METHOD, phoneFmt, waLink, STATUS } from '../util.js';
import { StatusBadge, PayBadge, Modal, Field, ErrorBox } from './ui.jsx';
import { useToast } from '../state.jsx';

const NEXT = {
  nouvelle: ['en_attente_confirmation', 'confirmee'], en_attente_confirmation: ['confirmee'], confirmee: ['en_preparation'], en_preparation: ['prete'],
  prete: ['en_livraison', 'livree'], en_livraison: ['livree'],
};

export default function OrderPanel({ o, role, reload }) {
  const toast = useToast();
  const base = role === 'admin' ? '/api/admin/orders' : '/api/seller/orders';
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [deliv, setDeliv] = useState(null);
  const [amounts, setAmounts] = useState(null);
  const [adminStatus, setAdminStatus] = useState(null);
  const [err, setErr] = useState(null);
  const run = async (fn, ok) => { setErr(null); try { await fn(); if (ok) toast(ok, 'ok'); reload(); } catch (e) { setErr(e); } };

  const next = NEXT[o.status] || [];
  const closed = ['livree', 'annulee'].includes(o.status);
  const mapsUrl = o.lat && o.lng ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : `https://www.google.com/maps/search/${encodeURIComponent(`${o.address_line}, ${o.quartier}, ${o.commune}, Sénégal`)}`;

  return (
    <div className="cols">
      <div>
        <div className="card">
          <div className="row between wrap"><div><h3 style={{ marginBottom: 2 }}>{o.order_no}</h3><div className="small muted">{dateFr(o.created_at)}{role === 'admin' ? ` · ${o.shop_name}` : ''}</div></div><div className="row"><StatusBadge status={o.status} /><PayBadge status={o.payment_status} /></div></div>
          {err && <div className="mt-s"><ErrorBox error={err} /></div>}
          {role === 'seller' && o.status === 'nouvelle' && <div className="row mt"><button className="btn btn-primary grow" onClick={() => run(() => api.post(`${base}/${o.id}/accept`), 'Commande acceptée')}>Accepter la commande</button><button className="btn btn-danger grow" onClick={() => setReject(true)}>Refuser</button></div>}
          {role === 'seller' && !closed && o.status !== 'nouvelle' && o.status !== 'en_attente_paiement' && (
            <div className="row wrap mt">
              {next.map((s) => <button key={s} className="btn btn-sm btn-primary" onClick={() => (s === 'en_livraison' ? setDeliv({ driver_name: o.driver_name || '', driver_phone: '' }) : run(() => api.post(`${base}/${o.id}/status`, { status: s }), `Statut : ${STATUS[s][0]}`))}>→ {STATUS[s][0]}</button>)}
              <button className="btn btn-sm btn-danger" onClick={() => setReject(true)}>Annuler / refuser</button>
            </div>
          )}
          {role === 'admin' && !closed && <button className="btn btn-sm btn-ghost mt" onClick={() => setAdminStatus({ status: o.status, note: '' })}>Modifier le statut (administrateur)</button>}
        </div>

        <div className="card"><h3>Produits commandés</h3>
          {o.items.map((it) => <div className="row" key={it.id} style={{ padding: '6px 0' }}>{it.image_url ? <img className="thumb" src={it.image_url} alt="" /> : <div className="thumb" />}<div className="grow"><b>{it.product_name}</b><div className="small muted">{num(it.quantity)} {it.unit} × {piFmt(it.unit_price)}</div></div><b>{piFmt(it.line_total)}</b></div>)}
          <div className="sumrow"><span>Sous-total</span><b>{piFmt(o.subtotal)}</b></div><div className="sumrow"><span>Livraison</span><b>{piFmt(o.delivery_fee)}</b></div>
          <div className="sumrow total"><span>Total estimé</span><span>{piFmt(o.total)}</span></div>
          {o.final_total != null && <div className="sumrow total"><span>Montant final (après pesée)</span><span className="price">{piFmt(o.final_total)}</span></div>}
          <div className="small muted mt-s">{PAY_METHOD[o.payment_method]}</div>
          {role === 'seller' && !closed && o.status !== 'en_attente_paiement' && o.payment_status === 'non_paye' && <button className="btn btn-sm btn-ghost mt-s" onClick={() => setAmounts({ final_total: o.final_total ?? '', delivery_fee: o.delivery_fee })}>Saisir le montant final / les frais</button>}
          {role === 'admin' && o.payment_status === 'paye' && <button className="btn btn-sm btn-danger mt-s" onClick={() => { const note = prompt('Note de remboursement (effectué hors plateforme) :'); if (note) run(() => api.post(`${base}/${o.id}/refund`, { note }), 'Remboursement enregistré'); }}>Enregistrer un remboursement</button>}
        </div>

        <div className="card"><h3>Historique</h3>
          <ul className="timeline">{o.history.map((h, i) => <li key={i} className={h.status === 'annulee' ? 'cancel' : ''}><StatusBadge status={h.status} />{h.note && <div className="small">{h.note}</div>}<time>{dateFr(h.created_at)}{h.by_name ? ` · ${h.by_name}` : ''}</time></li>)}</ul></div>
      </div>

      <aside className="aside">
        <div className="card"><h3>Client</h3>
          <b>{o.customer_name}</b>{o.pi_username && <div className="small">π {o.pi_username}</div>}
          <div className="small muted">{phoneFmt(o.customer_phone)}{o.customer_email ? ` · ${o.customer_email}` : ''}</div>
          <div className="row wrap mt-s"><a className="btn btn-sm btn-primary" href={`tel:+221${o.customer_phone}`}><Phone size={15} /> Appeler</a><a className="btn btn-sm btn-ghost" href={waLink(o.customer_phone, `Bonjour ${o.customer_name}, concernant votre commande ${o.order_no} sur GÉEJ MARKET…`)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a></div>
        </div>
        <div className="card small"><h3>Livraison</h3>
          <b>{MODES[o.delivery_mode]}</b>
          <div className="row mt-s" style={{ alignItems: 'flex-start' }}><MapPin size={18} color="var(--turq-d)" /><div>{o.address_line}{o.landmark ? <><br />Repère : {o.landmark}</> : null}<br />{o.quartier}, {o.commune}<br />{o.department}, {o.region_name}</div></div>
          <a className="btn btn-sm btn-ghost mt-s" href={mapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Voir sur la carte</a>
          {o.eta_text && <div className="mt-s">Délai annoncé : {o.eta_text}</div>}
          {o.driver_name && <div>Livreur : {o.driver_name}{o.driver_phone ? ` · ${phoneFmt(o.driver_phone)}` : ''}</div>}
          {o.comment && <div className="notice mt-s"><div><b>Commentaire du client :</b> {o.comment}</div></div>}
        </div>
      </aside>

      {reject && <Modal title="Refuser / annuler la commande" onClose={() => setReject(false)}>
        <Field label="Motif (obligatoire, visible par le client)" required><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        <div className="row mt"><button className="btn btn-ghost grow" onClick={() => setReject(false)}>Retour</button><button className="btn btn-danger grow" disabled={reason.trim().length < 3} onClick={() => { setReject(false); run(() => api.post(`${base}/${o.id}/reject`, { reason }), 'Commande annulée'); }}>Confirmer</button></div></Modal>}
      {deliv && <Modal title="Passer en livraison" onClose={() => setDeliv(null)}>
        <div className="stack"><Field label="Nom du livreur (facultatif)"><input value={deliv.driver_name} onChange={(e) => setDeliv({ ...deliv, driver_name: e.target.value })} /></Field>
          <Field label="Téléphone du livreur (facultatif)"><input inputMode="tel" value={deliv.driver_phone} onChange={(e) => setDeliv({ ...deliv, driver_phone: e.target.value })} /></Field>
          <button className="btn btn-primary" onClick={() => { const d = deliv; setDeliv(null); run(() => api.post(`${base}/${o.id}/status`, { status: 'en_livraison', driver_name: d.driver_name || undefined, driver_phone: d.driver_phone || undefined }), 'En cours de livraison'); }}>Valider</button></div></Modal>}
      {amounts && <Modal title="Montant final et frais" onClose={() => setAmounts(null)}>
        <div className="stack"><Field label="Montant final après pesée (π, produits + livraison)" hint={`Estimation actuelle : ${piFmt(o.total)}`}><input type="number" min="0" step="any" value={amounts.final_total} onChange={(e) => setAmounts({ ...amounts, final_total: e.target.value })} /></Field>
          <Field label="Frais de livraison (π)"><input type="number" min="0" step="any" value={amounts.delivery_fee} onChange={(e) => setAmounts({ ...amounts, delivery_fee: e.target.value })} /></Field>
          <button className="btn btn-primary" onClick={() => { const a = amounts; setAmounts(null); run(() => api.patch(`${base}/${o.id}/amounts`, { final_total: a.final_total === '' ? undefined : Number(a.final_total), delivery_fee: Number(a.delivery_fee) }), 'Montants enregistrés'); }}>Enregistrer</button></div></Modal>}
      {adminStatus && <Modal title="Modifier le statut" onClose={() => setAdminStatus(null)}>
        <div className="stack"><Field label="Nouveau statut"><select value={adminStatus.status} onChange={(e) => setAdminStatus({ ...adminStatus, status: e.target.value })}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Motif (obligatoire, journalisé)" required><input value={adminStatus.note} onChange={(e) => setAdminStatus({ ...adminStatus, note: e.target.value })} /></Field>
          <button className="btn btn-primary" disabled={adminStatus.note.trim().length < 3 || adminStatus.status === o.status} onClick={() => { const a = adminStatus; setAdminStatus(null); run(() => api.post(`${base}/${o.id}/status`, a), 'Statut modifié'); }}>Valider</button></div></Modal>}
    </div>
  );
}
