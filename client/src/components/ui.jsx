import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Fish, PackageX } from 'lucide-react';
import { piFmt, num, STATUS, PAY_STATUS, unitLabel } from '../util.js';
import { useCart, useAuth, useConfig, useToast } from '../state.jsx';

export const Spinner = () => <div className="spinner" role="status" aria-label="Chargement" />;

export function Empty({ icon: Icon = PackageX, title, children }) {
  return (
    <div className="empty"><Icon size={44} strokeWidth={1.5} /><h3 style={{ color: 'var(--ocean)', marginBottom: 6 }}>{title}</h3>{children}</div>
  );
}

export const StatusBadge = ({ status }) => { const [l, c] = STATUS[status] || [status, 'grey']; return <span className={`badge ${c}`}>{l}</span>; };
export const PayBadge = ({ status }) => { const [l, c] = PAY_STATUS[status] || [status, 'grey']; return <span className={`badge ${c}`}>{l}</span>; };

export function Field({ label, required, hint, error, children, className = '' }) {
  const id = useId();
  const child = children && typeof children === 'object' && 'props' in children ? { ...children, props: { id, ...children.props } } : children;
  return (
    <div className={`field ${error ? 'bad' : ''} ${className}`}>
      {label && <label htmlFor={id}>{label}{required && <span className="req"> *</span>}</label>}
      {child}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}><h3>{title}</h3>{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return <label className="switch" aria-label={label}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>;
}

// Sélecteur de quantité respectant le pas et le minimum du produit
export function QtyStepper({ product, value, onChange, small, allowZero }) {
  const step = Number(product.qty_step), min = Number(product.min_qty);
  const maxQ = Math.floor(Number(product.stock) / step + 1e-9) * step;
  const dec = () => { const n = +(value - step).toFixed(3); onChange(n < min - 1e-9 ? (allowZero ? 0 : min) : n); };
  const inc = () => onChange(Math.min(+(value + step).toFixed(3), maxQ));
  return (
    <div className={`qty ${small ? 'sm' : ''}`}>
      <button type="button" aria-label="Diminuer" onClick={dec} disabled={!allowZero && value <= min + 1e-9}><Minus size={16} /></button>
      <span aria-live="polite">{num(value)} {product.unit}</span>
      <button type="button" aria-label="Augmenter" onClick={inc} disabled={value >= maxQ - 1e-9}><Plus size={16} /></button>
    </div>
  );
}

export const imgOf = (p) => p.images?.[0] || null;

export function Photo({ product, alt }) {
  const src = imgOf(product);
  return src ? <img src={src} alt={alt ?? product.name} loading="lazy" decoding="async" /> : <div className="ph empty"><Fish size={40} strokeWidth={1.4} /></div>;
}

export function ProductCard({ p }) {
  const { add } = useCart();
  const { user } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const buy = async () => { if (await add(p)) nav(user ? '/commander' : '/connexion', { state: { from: '/commander' } }); };
  return (
    <div className={`pcard ${p.available ? '' : 'off'}`}>
      <Link to={`/produit/${p.id}`} aria-label={p.name}>
        <div className={`ph ${imgOf(p) ? '' : 'empty'}`}>
          {imgOf(p) ? <img src={imgOf(p)} alt={p.name} loading="lazy" decoding="async" /> : <Fish size={40} strokeWidth={1.4} />}
          <div className="tag">
            {!p.available ? <span className="badge grey">Indisponible</span> : p.is_promo ? <span className="badge coral">Promo</span> : p.condition !== 'frais' ? <span className="badge">{p.condition}</span> : null}
          </div>
        </div>
      </Link>
      <div className="body">
        <Link to={`/produit/${p.id}`} className="name" style={{ color: 'var(--ink)' }}>{p.name}</Link>
        <span className="unit">{p.unit_detail ? p.unit_detail : `1 ${p.unit}`}</span>
        <div className="foot">
          <div>
            {p.is_promo && <span className="old">{piFmt(p.price)}</span>}
            <span className="price">{piFmt(p.effective_price)}</span>
            {!p.unit_detail && p.unit !== 'kg' ? <span className="muted small"> / {p.unit}</span> : null}
          </div>
          <button className="addbtn" disabled={!p.available} aria-label={`Ajouter ${p.name} au panier`} onClick={() => add(p)}><Plus size={20} /></button>
        </div>
        <button className="btn btn-coral btn-sm btn-block buybtn" disabled={!p.available} onClick={buy}>Acheter</button>
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ n = 4 }) {
  return <div className="grid">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>;
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && setState({ loading: false, data, error: null })).catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export const ErrorBox = ({ error, retry }) => (
  <div className="notice bad" role="alert"><div className="grow">{error?.message || 'Erreur.'}</div>{retry && <button className="btn btn-sm btn-ghost" onClick={retry}>Réessayer</button>}</div>
);

export { unitLabel };
