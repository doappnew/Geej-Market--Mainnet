import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, ArrowRight, ArrowLeft, ShoppingCart, Truck, Info } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num } from '../util.js';
import { ScreenShell } from '../components/Layout.jsx';
import { Empty, QtyStepper, Spinner, Photo, Field } from '../components/ui.jsx';
import { useAuth, useCart, useConfig } from '../state.jsx';

export default function Cart() {
  const { lines, loading, setQty, remove, clear, subtotal } = useCart();
  const { user } = useAuth();
  const cfg = useConfig();
  const nav = useNavigate();
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState(() => localStorage.getItem('geej_region') || '');
  const [quote, setQuote] = useState(null);

  useEffect(() => { api.get('/api/geo/regions').then((r) => setRegions(r.regions)).catch(() => {}); }, []);
  useEffect(() => {
    if (!lines.length) { setQuote(null); return; }
    const items = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
    let alive = true;
    api.post('/api/checkout/quote', { items, region_id: regionId ? Number(regionId) : undefined, mode: 'domicile' }).then((q) => alive && setQuote(q)).catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [lines, regionId]);
  const pickRegion = (v) => { setRegionId(v); try { localStorage.setItem('geej_region', v); } catch { /* ignoré */ } };

  const goOrder = () => nav(user ? '/commander' : '/connexion', { state: { from: '/commander' } });
  const fee = quote?.fee_known ? quote.delivery_fee : null;
  const total = subtotal + (fee || 0);

  return (
    <ScreenShell title="Mon panier" right={lines.length > 0 ? <button className="iconbtn" aria-label="Vider le panier" onClick={() => confirm('Vider le panier ?') && clear()}><Trash2 size={21} /></button> : null}>
      {loading && <Spinner />}
      {!loading && !lines.length && (
        <Empty icon={ShoppingCart} title="Votre panier est vide">
          <p>Découvrez nos poissons, crustacés et coquillages.</p><Link to="/produits" className="btn btn-primary">Découvrir nos produits</Link>
        </Empty>
      )}
      {lines.length > 0 && (
        <div className="cols">
          <div>
            {lines.map((l) => (
              <div className="line" key={l.product_id}>
                <Link to={`/produit/${l.product_id}`} className="im"><Photo product={l.product} /></Link>
                <div className="stack" style={{ gap: 6 }}>
                  <div className="row between"><Link to={`/produit/${l.product_id}`} style={{ color: 'var(--ink)', fontWeight: 700 }}>{l.product.name}</Link>
                    <button className="iconbtn" style={{ color: 'var(--danger)', width: 34, height: 34 }} aria-label={`Retirer ${l.product.name}`} onClick={() => remove(l.product)}><Trash2 size={19} /></button></div>
                  <div className="muted small">{piFmt(l.product.effective_price)} / {l.product.unit}{l.product.unit_detail ? ` (${l.product.unit_detail})` : ''}</div>
                  <div className="row between wrap">
                    <QtyStepper small allowZero product={l.product} value={l.quantity} onChange={(q) => setQty(l.product, q)} />
                    <span className="price">{piFmt(l.line_total)}</span>
                  </div>
                  {!l.product.available && <span className="badge red">Plus disponible — retirez-le pour commander</span>}
                </div>
              </div>
            ))}
          </div>

          <aside className="aside">
            <div className="card">
              <h3>Récapitulatif</h3>
              <div className="sumrow"><span>Sous-total ({lines.length} produit{lines.length > 1 ? 's' : ''})</span><b>{piFmt(subtotal)}</b></div>
              <div className="sumrow"><span>Frais de livraison</span><b>{fee != null ? piFmt(fee) : <span className="muted small">Choisissez votre région</span>}</b></div>
              <div className="sumrow total"><span>Total {fee != null ? '' : 'estimé'}</span><span className="price">{piFmt(total)}</span></div>
              <Field label="Estimer la livraison pour la région" className="mt-s">
                <select value={regionId} onChange={(e) => pickRegion(e.target.value)}><option value="">— Choisir —</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              </Field>
              {quote && regionId && quote.sellers.map((s) => (
                <div key={s.seller_id} className={`notice mt-s ${s.served ? '' : 'warn'}`}>
                  {s.served ? <Truck size={18} /> : <Info size={18} />}<div className="small">{s.served ? `${s.shop_name} : livraison ${piFmt(s.fee)}, délai ${s.eta_text}.` : s.reason}</div>
                </div>
              ))}
              {quote?.problems?.map((p, i) => <div key={i} className="notice bad mt-s small">{p.message}</div>)}
            </div>
            <div className="stack mt">
              <button className="btn btn-primary btn-block" onClick={goOrder} disabled={!!quote?.problems?.length}>Passer la commande <ArrowRight size={18} /></button>
              <Link to="/produits" className="btn btn-ghost btn-block"><ArrowLeft size={18} /> Continuer mes achats</Link>
            </div>
            <p className="small muted center mt-s">Les prix et les stocks sont vérifiés à la validation de la commande.</p>
          </aside>
        </div>
      )}
    </ScreenShell>
  );
}
