import { useState } from 'react';
import { api } from '../api.js';
import { piFmt } from '../util.js';
import { Field, Modal, Spinner, ErrorBox, Switch, useAsync } from './ui.jsx';
import { useToast } from '../state.jsx';

// Gestion des zones de livraison (vendeur: ses zones; admin: toutes, avec choix du vendeur)
export default function ZonesManager({ admin }) {
  const base = admin ? '/api/admin/zones' : '/api/seller/zones';
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useAsync(() => api.get(base), [tick]);
  const regions = useAsync(() => api.get('/api/geo/regions'), []);
  const sellers = useAsync(() => (admin ? api.get('/api/admin/sellers') : Promise.resolve(null)), []);
  const [edit, setEdit] = useState(null);

  const toggle = async (z, patch) => {
    try { const { region_name, shop_name, id, seller_id, ...rest } = z; await api.put(`${base}/${z.id}`, { ...rest, ...patch }); setTick(tick + 1); } catch (e) { toast(e.message, 'bad'); }
  };
  const del = async (z) => { if (confirm('Supprimer cette zone ?')) { await api.del(`${base}/${z.id}`); setTick(tick + 1); } };

  return (
    <>
      <div className="row between mb"><h1 style={{ margin: 0 }}>Zones et frais de livraison</h1><button className="btn btn-primary" onClick={() => setEdit({ fee: 0, eta_text: '24 h', min_order: 0, home_delivery: true, pickup_available: false, is_active: true })}>Ajouter une zone</button></div>
      <p className="muted small">Une zone « Toute la région » s’applique à toutes les communes ; une zone avec commune a la priorité. Une région sans zone active n’est pas desservie.</p>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      <div className="tablewrap"><table className="t"><thead><tr>{admin && <th>Vendeur</th>}<th>Région</th><th>Commune</th><th>Frais</th><th>Délai</th><th>Min. commande</th><th>Domicile</th><th>Retrait</th><th>Active</th><th /></tr></thead>
        <tbody>{data?.zones.map((z) => (
          <tr key={z.id}>{admin && <td>{z.shop_name}</td>}<td><b>{z.region_name}</b></td><td>{z.commune || <span className="muted">Toute la région</span>}</td><td>{piFmt(z.fee)}</td><td>{z.eta_text}</td><td>{z.min_order ? piFmt(z.min_order) : '—'}</td>
            <td><Switch checked={z.home_delivery} onChange={(v) => toggle(z, { home_delivery: v })} label="Livraison à domicile" /></td>
            <td><Switch checked={z.pickup_available} onChange={(v) => toggle(z, { pickup_available: v })} label="Retrait" /></td>
            <td><Switch checked={z.is_active} onChange={(v) => toggle(z, { is_active: v })} label="Zone active" /></td>
            <td><div className="row"><button className="btn btn-sm btn-ghost" onClick={() => setEdit(z)}>Modifier</button><button className="btn btn-sm btn-danger" onClick={() => del(z)}>Suppr.</button></div></td></tr>
        ))}</tbody></table></div>
      {data && !data.zones.length && <p className="muted center mt">Aucune zone configurée : aucune livraison n’est proposée aux clients.</p>}
      {edit && <ZoneForm z={edit} admin={admin} base={base} regions={regions.data?.regions || []} sellers={sellers.data?.sellers || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick(tick + 1); toast('Zone enregistrée', 'ok'); }} />}
    </>
  );
}

function ZoneForm({ z, admin, base, regions, sellers, onClose, onSaved }) {
  const [f, setF] = useState({ seller_id: z.seller_id || '', region_id: z.region_id ? String(z.region_id) : '', commune: z.commune || '', fee: z.fee ?? 0, eta_text: z.eta_text || '24 h', min_order: z.min_order ?? 0, conditions: z.conditions || '', home_delivery: z.home_delivery ?? true, pickup_available: !!z.pickup_available, pickup_address: z.pickup_address || '', is_active: z.is_active ?? true });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    const body = { ...f, region_id: Number(f.region_id), fee: Number(f.fee), min_order: Number(f.min_order), commune: f.commune || null, conditions: f.conditions || null, pickup_address: f.pickup_address || null };
    if (!admin) delete body.seller_id; else body.seller_id = Number(f.seller_id);
    try { if (z.id) await api.put(`${base}/${z.id}`, body); else await api.post(base, body); onSaved(); } catch (e2) { setErr(e2); }
  };
  return (
    <Modal title={z.id ? 'Modifier la zone' : 'Nouvelle zone'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {admin && !z.id && <Field label="Vendeur" required><select value={f.seller_id} onChange={set('seller_id')} required><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.shop_name}</option>)}</select></Field>}
        <div className="fgrid two">
          <Field label="Région" required><select value={f.region_id} onChange={set('region_id')} required><option value="">—</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Commune (facultatif)" hint="Vide = toute la région"><input value={f.commune} onChange={set('commune')} /></Field>
          <Field label="Frais de livraison (π)" required><input type="number" min="0" step="any" value={f.fee} onChange={set('fee')} required /></Field>
          <Field label="Délai estimé" required><input value={f.eta_text} onChange={set('eta_text')} placeholder="2 à 4 h" required /></Field>
          <Field label="Montant minimum (π)"><input type="number" min="0" step="any" value={f.min_order} onChange={set('min_order')} /></Field>
        </div>
        <Field label="Conditions de livraison"><textarea value={f.conditions} onChange={set('conditions')} maxLength={500} /></Field>
        <label className="check"><input type="checkbox" checked={f.home_delivery} onChange={set('home_delivery')} /> Livraison à domicile / adresse professionnelle</label>
        <label className="check"><input type="checkbox" checked={f.pickup_available} onChange={set('pickup_available')} /> Retrait possible</label>
        {f.pickup_available && <Field label="Adresse du point de retrait"><input value={f.pickup_address} onChange={set('pickup_address')} /></Field>}
        <label className="check"><input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> Zone active</label>
        {err && <ErrorBox error={err} />}
        <div className="row"><button type="button" className="btn btn-ghost grow" onClick={onClose}>Annuler</button><button className="btn btn-primary grow">Enregistrer</button></div>
      </form>
    </Modal>
  );
}
