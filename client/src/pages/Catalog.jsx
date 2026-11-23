import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, SearchX } from 'lucide-react';
import { api } from '../api.js';
import { CONDITIONS } from '../util.js';
import { ClientShell } from '../components/Layout.jsx';
import { ProductCard, ProductGridSkeleton, useAsync, ErrorBox, Empty, Modal, Field } from '../components/ui.jsx';

const SORTS = { popular: 'Popularité', new: 'Nouveautés', price_asc: 'Prix croissant', price_desc: 'Prix décroissant', name: 'Nom (A-Z)' };

export default function Catalog() {
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(sp.get('filtres') === '1');
  const get = (k, d = '') => sp.get(k) ?? d;
  const set = (patch) => { const n = new URLSearchParams(sp); n.delete('filtres'); Object.entries(patch).forEach(([k, v]) => (v === '' || v == null ? n.delete(k) : n.set(k, v))); if (!('page' in patch)) n.delete('page'); setSp(n); };

  const cats = useAsync(() => api.get('/api/categories'), []);
  const qs = new URLSearchParams();
  const map = { q: 'search', categorie: 'category', condition: 'condition', min: 'min_price', max: 'max_price', dispo: 'available', promo: 'promo', selection: 'featured', tri: 'sort', page: 'page' };
  for (const [k, v] of Object.entries(map)) if (sp.get(k)) qs.set(v, k === 'selection' || k === 'dispo' || k === 'promo' ? '1' : sp.get(k));
  qs.set('limit', '12');
  const { data, loading, error } = useAsync(() => api.get(`/api/products?${qs}`), [sp.toString()]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [sp.get('page')]);

  const active = ['condition', 'min', 'max', 'dispo', 'promo', 'selection'].filter((k) => sp.get(k)).length;
  const page = Number(get('page', 1));

  return (
    <ClientShell>
      <div className="row between mb">
        <h1 style={{ fontSize: 22, color: 'var(--ocean)' }}>{get('q') ? `« ${get('q')} »` : 'Nos produits'}</h1>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}><SlidersHorizontal size={16} /> Filtres{active ? ` (${active})` : ''}</button>
      </div>
      <div className="chips mb">
        <button className={`chip ${!get('categorie') ? 'on' : ''}`} onClick={() => set({ categorie: '' })}>Tout</button>
        {cats.data?.categories.map((c) => <button key={c.id} className={`chip ${get('categorie') === c.slug ? 'on' : ''}`} onClick={() => set({ categorie: c.slug })}>{c.name}</button>)}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <ProductGridSkeleton n={8} />}
      {data && (data.items.length ? (
        <>
          <div className="muted small mb">{data.total} produit(s)</div>
          <div className="grid">{data.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          {data.pages > 1 && (
            <div className="pager">
              <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Précédent</button>
              <span className="small">Page {page} / {data.pages}</span>
              <button className="btn btn-sm btn-ghost" disabled={page >= data.pages} onClick={() => set({ page: String(page + 1) })}>Suivant</button>
            </div>
          )}
        </>
      ) : <Empty icon={SearchX} title="Aucun produit trouvé">Essayez d’autres mots-clés ou retirez des filtres.</Empty>)}

      {open && <FiltersModal sp={sp} onClose={() => setOpen(false)} onApply={(p) => { set(p); setOpen(false); }} />}
    </ClientShell>
  );
}

function FiltersModal({ sp, onClose, onApply }) {
  const [f, setF] = useState({ condition: sp.get('condition') || '', min: sp.get('min') || '', max: sp.get('max') || '', dispo: sp.get('dispo') || '', promo: sp.get('promo') || '', tri: sp.get('tri') || 'popular' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '') : e.target.value });
  return (
    <Modal title="Filtres et tri" onClose={onClose}>
      <div className="stack">
        <Field label="Trier par"><select value={f.tri} onChange={up('tri')}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="État de conservation"><select value={f.condition} onChange={up('condition')}><option value="">Tous</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <div className="fgrid two">
          <Field label="Prix min (π)"><input inputMode="decimal" value={f.min} onChange={up('min')} /></Field>
          <Field label="Prix max (π)"><input inputMode="decimal" value={f.max} onChange={up('max')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.dispo} onChange={up('dispo')} /> Produits disponibles uniquement</label>
        <label className="check"><input type="checkbox" checked={!!f.promo} onChange={up('promo')} /> Promotions uniquement</label>
        <div className="row"><button className="btn btn-ghost grow" onClick={() => onApply({ condition: '', min: '', max: '', dispo: '', promo: '', tri: '', selection: '' })}>Réinitialiser</button><button className="btn btn-primary grow" onClick={() => onApply(f)}>Appliquer</button></div>
      </div>
    </Modal>
  );
}
