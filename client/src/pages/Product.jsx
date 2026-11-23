import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Share2, Snowflake, Scale, Box, Thermometer, ShieldCheck, Truck, ShoppingBasket, ChevronRight, ShoppingCart, Store } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num, unitLabel, dayFr } from '../util.js';
import { Brand, BottomNav } from '../components/Layout.jsx';
import { QtyStepper, Spinner, ErrorBox } from '../components/ui.jsx';
import { useAsync } from '../components/ui.jsx';
import { useAuth, useCart, useConfig, useToast } from '../state.jsx';

export default function Product() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { add } = useCart();
  const cfg = useConfig();
  const toast = useToast();
  const { data, loading, error } = useAsync(() => api.get(`/api/products/${id}`), [id]);
  const p = data?.product;
  const [qty, setQ] = useState(1);
  const [img, setImg] = useState(0);
  useEffect(() => { if (p) { setQ(p.min_qty); setImg(0); } }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); toast('Lien copié'); } } catch { /* annulé */ }
  };
  const total = p ? Math.round(p.effective_price * qty) : 0;

  const addToCart = () => add(p, qty);
  const orderNow = async () => { if (await addToCart()) nav(user ? '/commander' : '/connexion', { state: { from: '/commander' } }); };

  return (
    <div className="shell">
      <header className="subbar">
        <div className="subbar-in">
          <div className="side"><button className="iconbtn" aria-label="Retour" onClick={() => nav(-1)}><ArrowLeft size={23} /></button></div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><Brand /></div>
          <div className="side"><button className="iconbtn" aria-label="Partager" onClick={share}><Share2 size={21} /></button></div>
        </div>
      </header>
      <main>
        {loading && <Spinner />}{error && <ErrorBox error={error} />}
        {p && (
          <div className="pgrid">
            <div className={`gallery ${p.images.length < 2 ? 'single' : ''}`}>
              <div className="main">
                {p.images[img] ? <img src={p.images[img]} alt={p.name} /> : null}
                <span className="badge" style={{ position: 'absolute', left: 10, top: 10 }}>{p.condition.toUpperCase()}</span>
                {p.images.length > 1 && <span className="badge grey" style={{ position: 'absolute', left: 10, bottom: 10 }}>{img + 1}/{p.images.length}</span>}
              </div>
              {p.images.length > 1 && <div className="thumbs">{p.images.map((u, i) => <button key={u} className={i === img ? 'on' : ''} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`}><img src={u} alt="" /></button>)}</div>}
            </div>

            <div className="stack">
              <div>
                <h1 style={{ fontSize: 24, color: 'var(--ink)' }}>{p.name}</h1>
                <div className="row wrap mt-s"><Link to={`/produits?categorie=${p.category_slug}`} className="badge">{p.category_name}</Link><span className="muted small"><Store size={13} style={{ verticalAlign: -2 }} /> {p.shop_name}{p.seller_city ? ` · ${p.seller_city}` : ''}</span></div>
              </div>
              <div>
                {p.is_promo && <span className="muted" style={{ textDecoration: 'line-through' }}>{piFmt(p.price)}</span>}
                <div className="price" style={{ fontSize: 28 }}>{piFmt(p.effective_price)} <span style={{ fontSize: 17 }}>/ {p.unit}{p.unit_detail ? ` (${p.unit_detail})` : ''}</span></div>
              </div>
              {p.description && <p style={{ margin: 0 }}>{p.description}</p>}

              <div className="facts">
                <div><Snowflake size={22} /><span><small>État</small><b style={{ textTransform: 'capitalize' }}>{p.condition}</b></span></div>
                <div><Scale size={22} /><span><small>Unité</small><b>{unitLabel(p)}</b></span></div>
                <div><Box size={22} /><span><small>Disponibilité</small><b>{p.available ? `En stock (${num(p.stock)})` : 'Indisponible'}</b></span></div>
                <div><Thermometer size={22} /><span><small>Conservation</small><b>{p.storage_info || '—'}</b></span></div>
              </div>
              {(p.prepared_on || p.available_from || p.traceability) && (
                <div className="card small">
                  {p.prepared_on && <div><b>Préparé le :</b> {dayFr(p.prepared_on)}</div>}
                  {p.available_from && <div><b>Disponible depuis le :</b> {dayFr(p.available_from)}</div>}
                  {p.traceability && <div><b>Traçabilité :</b> {p.traceability}</div>}
                </div>
              )}

              {p.available ? (
                <div className="fgrid two" style={{ alignItems: 'center' }}>
                  <div><div className="small muted" style={{ marginBottom: 4 }}>Quantité {p.qty_step < 1 || p.min_qty > 1 ? `(par ${num(p.qty_step)} ${p.unit}, min. ${num(p.min_qty)})` : ''}</div><QtyStepper product={p} value={qty} onChange={setQ} /></div>
                  <div className="estimate"><div><div className="small muted">Total estimé</div><div className="price">{piFmt(total)}</div></div><ShoppingBasket size={30} color="var(--turq-d)" /></div>
                </div>
              ) : <div className="notice warn">Ce produit n’est pas disponible pour le moment.</div>}

              <div className="notice"><ShieldCheck size={22} style={{ flex: 'none' }} /><div><b>Produits sélectionnés avec soin</b><div className="small">Le poids final peut varier légèrement : le vendeur confirme le montant exact après pesée.</div></div></div>
              <Link to="/infos/livraison" className="card row" style={{ color: 'var(--ink)' }}><Truck size={26} color="var(--turq-d)" /><div className="grow"><b>Livraison au Sénégal</b><div className="small muted">À domicile ou en point de retrait, selon la zone du vendeur.</div></div><ChevronRight /></Link>

              <div className="sticky-cta">
                <button className="btn btn-ghost" disabled={!p.available} onClick={addToCart}><ShoppingCart size={18} /> Ajouter au panier</button>
                <button className="btn btn-coral" disabled={!p.available} onClick={orderNow}>Commander maintenant</button>
              </div>
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
