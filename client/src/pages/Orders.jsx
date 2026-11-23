import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipboardList, Phone, MessageCircle, CheckCircle2, Truck, MapPin, Wallet, LifeBuoy, ReceiptText } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num, dateFr, MODES, PAY_METHOD, phoneFmt, waLink } from '../util.js';
import { ScreenShell } from '../components/Layout.jsx';
import { Empty, StatusBadge, PayBadge, Spinner, ErrorBox, useAsync, Modal, Field } from '../components/ui.jsx';
import { useAuth, useConfig, useToast } from '../state.jsx';
import { inPiBrowser, payOrderWithPi } from '../pi.js';

export function OrdersList() {
  const { user, ready } = useAuth();
  const [sp] = useSearchParams();
  const { data, loading, error } = useAsync(() => (user ? api.get('/api/orders') : Promise.resolve(null)), [user?.id]);
  if (ready && !user) return (
    <ScreenShell title="Mes commandes"><Empty icon={ClipboardList} title="Connectez-vous pour voir vos commandes"><Link to="/connexion" state={{ from: '/commandes' }} className="btn btn-primary">Se connecter</Link></Empty></ScreenShell>
  );
  return (
    <ScreenShell title="Mes commandes">
      {sp.get('nouvelle') && <div className="notice mb"><CheckCircle2 size={20} /><div>Vos commandes ont été enregistrées. Chaque vendeur va les traiter.</div></div>}
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && !data.orders.length && <Empty icon={ClipboardList} title="Aucune commande pour le moment"><Link to="/produits" className="btn btn-primary">Découvrir nos produits</Link></Empty>}
      <div className="stack">
        {data?.orders.map((o) => (
          <Link to={`/commandes/${o.id}`} key={o.id} className="card ocard">
            <div className="row between"><b>{o.order_no}</b><StatusBadge status={o.status} /></div>
            <div className="row mt-s">
              <div className="row" style={{ gap: 4 }}>{(o.images || []).map((u, i) => <img key={i} src={u} alt="" className="thumb" />)}</div>
              <div className="grow small muted">{o.item_count} article(s) · {o.shop_name}<br />{dateFr(o.created_at)}</div>
              <div style={{ textAlign: 'right' }}><div className="price">{piFmt(o.final_total ?? o.total)}</div><PayBadge status={o.payment_status} /></div>
            </div>
          </Link>
        ))}
      </div>
    </ScreenShell>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = useConfig();
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useAsync(() => api.get(`/api/orders/${id}`), [id, tick]);
  const [paying, setPaying] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const o = data?.order;

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 45000); return () => clearInterval(t); }, []);

  const pay = async () => {
    setPaying('Ouverture du portefeuille Pi…');
    try { await payOrderWithPi(o.id, { onStatus: setPaying }); toast('Paiement confirmé ✓', 'ok'); }
    catch (e) { if (!e.cancelled) toast(e.message, 'bad'); }
    finally { setPaying(''); setTick((x) => x + 1); }
  };
  useEffect(() => { if (o && sp.get('payer') && o.payment_method === 'pi' && o.payment_status !== 'paye' && inPiBrowser()) { setSp({}, { replace: true }); pay(); } }, [o?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doCancel = async () => {
    try { await api.post(`/api/orders/${o.id}/cancel`, { reason }); toast('Commande annulée'); setCancel(false); setTick((x) => x + 1); } catch (e) { toast(e.message, 'bad'); }
  };

  const cancellable = o && ['en_attente_paiement', 'nouvelle', 'en_attente_confirmation'].includes(o.status) && o.payment_status === 'non_paye';
  const amount = o?.final_total ?? o?.total;

  return (
    <ScreenShell title={o?.order_no || 'Commande'} back="/commandes">
      {loading && !o && <Spinner />}{error && <ErrorBox error={error} />}
      {o && (
        <div className="cols">
          <div>
            {sp.get('nouvelle') && <div className="notice mb"><CheckCircle2 size={22} /><div><b>Commande enregistrée !</b><div className="small">Le vendeur va la confirmer et vous contacter. Conservez votre numéro : <b>{o.order_no}</b>.</div></div></div>}
            <div className="card">
              <div className="row between wrap"><StatusBadge status={o.status} /><PayBadge status={o.payment_status} /></div>
              <h3 className="mt">Suivi</h3>
              <ul className="timeline">
                {o.history.map((h, i) => <li key={i} className={h.status === 'annulee' ? 'cancel' : ''}><b><StatusBadge status={h.status} /></b>{h.note && <div className="small">{h.note}</div>}<time>{dateFr(h.created_at)}</time></li>)}
              </ul>
              {o.reject_reason && <div className="notice bad small">Motif : {o.reject_reason}</div>}
            </div>
            <div className="card">
              <h3>Articles</h3>
              {o.items.map((it) => (
                <div className="row" key={it.id} style={{ padding: '6px 0' }}>
                  {it.image_url ? <img src={it.image_url} alt="" className="thumb" /> : <div className="thumb" />}
                  <div className="grow"><b>{it.product_name}</b><div className="small muted">{num(it.quantity)} {it.unit} × {piFmt(it.unit_price)}</div></div><b>{piFmt(it.line_total)}</b>
                </div>
              ))}
            </div>
          </div>
          <aside className="aside">
            <div className="card">
              <h3>Montants</h3>
              <div className="sumrow"><span>Sous-total</span><b>{piFmt(o.subtotal)}</b></div>
              <div className="sumrow"><span>Livraison</span><b>{piFmt(o.delivery_fee)}</b></div>
              <div className="sumrow"><span>Total estimé</span><b>{piFmt(o.total)}</b></div>
              {o.final_total != null && <div className="sumrow total"><span>Montant final</span><span className="price">{piFmt(o.final_total)}</span></div>}
              <div className="small muted mt-s"><Wallet size={14} style={{ verticalAlign: -2 }} /> {PAY_METHOD[o.payment_method]}</div>
              {o.payment_method === 'pi' && o.payment_status !== 'paye' && !['annulee', 'livree'].includes(o.status) && (
                <div className="mt-s">
                  <button className="btn btn-coral btn-block" disabled={!!paying || !inPiBrowser() || !user?.has_pi || !cfg.pi_payment_enabled} onClick={pay}>{paying || `Payer ${piFmt(amount)}`}</button>
                  {!inPiBrowser() && <div className="small muted mt-s">Le paiement en Pi se fait dans Pi Browser, avec votre compte Pi.</div>}
                  {inPiBrowser() && !user?.has_pi && <div className="small muted mt-s">Connectez-vous avec Pi depuis l’onglet Compte.</div>}
                </div>
              )}
              {o.status === 'annulee' && o.payment_status === 'paye' && <div className="small mt-s" style={{ color: 'var(--coral-d, #c4651f)' }}>Commande annulée : votre paiement en Pi va vous être remboursé. Vous serez notifié dès que c’est fait.</div>}
              {o.payment_status === 'paye' && (
                <div className="stack mt-s">
                  <Link to={`/commandes/${o.id}/recu`} className="btn btn-primary btn-block"><ReceiptText size={18} /> Voir / télécharger mon reçu</Link>
                  <div className="small muted">Gardez votre reçu : présentez-le à la livraison pour recevoir votre commande.</div>
                </div>
              )}
              {o.status !== 'livree' && o.payment_status !== 'non_paye' && (
                <Link to={`/compte/reclamations?commande=${o.id}`} className="btn btn-ghost btn-block mt-s"><LifeBuoy size={18} /> Je n’ai pas reçu ma commande : déposer une plainte</Link>
              )}
              {o.payments.some((p) => p.status === 'paye') && <div className="small mt-s" style={{ color: 'var(--ok)' }}>Paiement reçu le {dateFr(o.payments.find((p) => p.status === 'paye').paid_at)}.</div>}
            </div>
            <div className="card small">
              <h3>Livraison</h3>
              <div className="row" style={{ alignItems: 'flex-start' }}><MapPin size={18} color="var(--turq-d)" /><div>{MODES[o.delivery_mode]}<br />{o.address_line}{o.landmark ? ` (${o.landmark})` : ''}<br />{o.quartier}, {o.commune}, {o.department}, {o.region_name}</div></div>
              {o.eta_text && <div className="row mt-s"><Truck size={18} color="var(--turq-d)" /><span>Délai estimé : {o.eta_text}</span></div>}
              {o.driver_name && <div className="mt-s">Livreur : <b>{o.driver_name}</b></div>}
            </div>
            <div className="card small">
              <h3>Vendeur : {o.shop_name}</h3>
              <div className="row wrap">
                {o.seller_phone && <a className="btn btn-sm btn-ghost" href={`tel:+221${o.seller_phone}`}><Phone size={15} /> {phoneFmt(o.seller_phone)}</a>}
                {o.seller_whatsapp && <a className="btn btn-sm btn-ghost" href={waLink(o.seller_whatsapp, `Bonjour, à propos de ma commande ${o.order_no}`)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
              </div>
            </div>
            <div className="stack mt">
              {cancellable && <button className="btn btn-danger btn-block" onClick={() => setCancel(true)}>Annuler la commande</button>}
              <Link className="btn btn-ghost btn-block" to={`/compte/reclamations?commande=${o.id}`}><LifeBuoy size={18} /> Signaler un problème</Link>
            </div>
          </aside>
        </div>
      )}
      {cancel && (
        <Modal title="Annuler la commande ?" onClose={() => setCancel(false)}>
          <Field label="Motif (facultatif)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          <div className="row mt"><button className="btn btn-ghost grow" onClick={() => setCancel(false)}>Retour</button><button className="btn btn-danger grow" onClick={doCancel}>Confirmer l’annulation</button></div>
        </Modal>
      )}
    </ScreenShell>
  );
}
