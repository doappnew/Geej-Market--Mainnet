import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MapPin, Truck, CreditCard, CheckCircle2, ArrowRight, ArrowLeft, Home, Building2, Store, Navigation, ShieldCheck, Info } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, num, MODES, phoneFmt } from '../util.js';
import { ScreenShell } from '../components/Layout.jsx';
import { Field, Spinner, Empty, ErrorBox } from '../components/ui.jsx';
import { useAuth, useCart, useConfig, useToast } from '../state.jsx';
import { inPiBrowser } from '../pi.js';

const DAKAR_COMMUNES = ['Dakar Plateau', 'Médina', 'Gueule Tapée-Fass-Colobane', 'Fann-Point E-Amitié', 'Grand Dakar', 'HLM', 'Biscuiterie', 'Grand Yoff', 'Parcelles Assainies', "Patte d'Oie", 'Ouakam', 'Ngor', 'Yoff', 'Mermoz-Sacré-Cœur', 'Sicap-Liberté', 'Dieuppeul-Derklé', 'Hann Bel-Air', 'Cambérène', 'Guédiawaye', 'Pikine', 'Thiaroye', 'Rufisque', 'Keur Massar', 'Bargny', 'Diamniadio'];
const MODE_ICON = { domicile: Home, professionnelle: Building2, retrait_vente: Store, retrait_relais: Store };
const normPhone = (v) => { const d = String(v || '').replace(/\D/g, '').replace(/^(00)?221/, ''); return /^(70|75|76|77|78|30|33)\d{7}$/.test(d) ? d : null; };
const STEPS = [['Adresse', MapPin], ['Livraison', Truck], ['Paiement', CreditCard], ['Confirmation', CheckCircle2]];

function Stepper({ step }) {
  return (
    <div className="steps" aria-label={`Étape ${step} sur 4`}>
      {STEPS.map(([label, Icon], i) => (
        <div key={label} style={{ display: 'contents' }}>
          <div className={`step ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`}><i><Icon size={18} /></i>{label}</div>
          {i < 3 && <div className={`stepline ${step > i + 1 ? 'done' : ''}`} />}
        </div>
      ))}
    </div>
  );
}

export default function Checkout() {
  const { user, ready } = useAuth();
  const { lines, loading, reload } = useCart();
  const cfg = useConfig();
  const toast = useToast();
  const nav = useNavigate();

  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState({ full_name: '', phone: '', pi_username: '' });
  const [addr, setAddr] = useState({ region_id: '', department: '', commune: '', quartier: '', address_line: '', landmark: '', lat: null, lng: null });
  const [mode, setMode] = useState('domicile');
  const [comment, setComment] = useState('');
    const [consent, setConsent] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [saveAddr, setSaveAddr] = useState(true);
  const [errors, setErrors] = useState({});
  const [regions, setRegions] = useState([]);
  const [deps, setDeps] = useState([]);
  const [saved, setSaved] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!user) return;
    setCustomer((c) => ({ ...c, full_name: c.full_name || user.full_name || '', phone: c.phone || phoneFmt(user.phone) || '', pi_username: c.pi_username || user.pi_username || '' }));
    api.get('/api/geo/regions').then((r) => setRegions(r.regions));
    api.get('/api/me/addresses').then((r) => {
      setSaved(r.addresses);
      const d = r.addresses.find((a) => a.is_default) || r.addresses[0];
      if (d) applySaved(d);
    }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (addr.region_id) api.get(`/api/geo/departments?region_id=${addr.region_id}`).then((r) => setDeps(r.departments)); else setDeps([]); }, [addr.region_id]);

  const applySaved = (a) => {
    setCustomer((c) => ({ ...c, full_name: a.full_name, phone: phoneFmt(a.phone) }));
    setAddr({ region_id: String(a.region_id), department: a.department, commune: a.commune, quartier: a.quartier, address_line: a.address_line, landmark: a.landmark || '', lat: null, lng: null });
  };

  // Devis pour chaque mode de livraison (disponibilité réelle selon les zones des vendeurs)
  const itemsKey = JSON.stringify(lines.map((l) => [l.product_id, l.quantity]));
  useEffect(() => {
    if (!lines.length || !addr.region_id) { setQuotes({}); return; }
    let alive = true;
    const items = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
    Promise.all(Object.keys(MODES).map((m) => api.post('/api/checkout/quote', { items, region_id: Number(addr.region_id), commune: addr.commune || undefined, mode: m }).then((q) => [m, q]).catch(() => [m, null])))
      .then((r) => alive && setQuotes(Object.fromEntries(r)));
    return () => { alive = false; };
  }, [itemsKey, addr.region_id, addr.commune]); // eslint-disable-line react-hooks/exhaustive-deps

  const quote = quotes[mode];
  const total = quote ? quote.total : lines.reduce((s, l) => s + l.line_total, 0);
  const piOk = cfg.pi_payment_enabled && user?.has_pi;
  const regionName = regions.find((r) => String(r.id) === String(addr.region_id))?.name;
  const firstZone = quote?.sellers?.[0];

  if (ready && !user) return <Navigate to="/connexion" state={{ from: '/commander' }} replace />;
  if (!ready || loading) return <ScreenShell title="Adresse de livraison"><Spinner /></ScreenShell>;
  if (!lines.length) return <ScreenShell title="Commande"><Empty title="Votre panier est vide"><Link className="btn btn-primary" to="/produits">Voir les produits</Link></Empty></ScreenShell>;

  const setA = (k) => (e) => setAddr({ ...addr, [k]: e.target.value });
  const setC = (k) => (e) => setCustomer({ ...customer, [k]: e.target.value });

  const validate1 = () => {
    const e = {};
    if (customer.full_name.trim().length < 2) e.full_name = 'Nom et prénom requis.';
    if (!normPhone(customer.phone)) e.phone = 'Numéro invalide (ex : 77 123 45 67).';
    if (!addr.region_id) e.region_id = 'Choisissez une région.';
    if (!addr.department) e.department = 'Choisissez un département.';
    if (addr.commune.trim().length < 2) e.commune = 'Commune ou ville requise.';
    if (addr.quartier.trim().length < 2) e.quartier = 'Quartier requis.';
    if (addr.address_line.trim().length < 3) e.address_line = 'Adresse détaillée requise.';
    setErrors(e);
    return !Object.keys(e).length;
  };
  const next = () => {
    if (step === 1 && !validate1()) { toast('Veuillez corriger les champs signalés.', 'bad'); return; }
    if (step === 2 && !quote?.can_order) return;
    setStep(step + 1); window.scrollTo({ top: 0 });
  };

  const locate = () => {
    if (!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil.', 'bad');
    navigator.geolocation.getCurrentPosition(
      (p) => { setAddr((a) => ({ ...a, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); toast('Position ajoutée', 'ok'); },
      () => toast("Impossible d'obtenir votre position.", 'bad'), { timeout: 10000 });
  };

  const confirm = async () => {
    setBusy(true); setSubmitError(null);
    try {
      const res = await api.post('/api/orders', {
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        customer: { ...customer, phone: normPhone(customer.phone) },
        address: { ...addr, region_id: Number(addr.region_id), lat: addr.lat ?? undefined, lng: addr.lng ?? undefined },
        delivery_mode: mode, comment: comment || undefined, consent_data: true, save_address: saveAddr && !saved.length,
      });
      await reload();
      const [o] = res.orders;
      if (res.orders.length === 1) nav(`/commandes/${o.id}?nouvelle=1${piOk ? '&payer=1' : ''}`, { replace: true });
      else nav('/commandes?nouvelle=1', { replace: true });
    } catch (e) { setSubmitError(e); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };

  const canNext = step === 2 ? !!quote?.can_order : true;

  return (
    <ScreenShell title={['Adresse de livraison', 'Mode de livraison', 'Paiement', 'Confirmation'][step - 1]} back={step > 1 ? undefined : '/panier'}
      right={<span className="small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={18} /></span>}>
      <Stepper step={step} />
      {submitError && <div className="mb"><ErrorBox error={submitError} /></div>}

      {step === 1 && (
        <div className="stack">
          {saved.length > 0 && (
            <Field label="Mes adresses enregistrées"><select defaultValue={(saved.find((a) => a.is_default) || saved[0]).id} onChange={(e) => { const a = saved.find((x) => String(x.id) === e.target.value); if (a) applySaved(a); }}>
              {saved.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.quartier}, {a.commune}</option>)}</select></Field>
          )}
          <div className="card">
            <h3>Vos coordonnées</h3>
            <div className="fgrid two">
              <Field label="Nom complet" required error={errors.full_name}><input autoComplete="name" value={customer.full_name} onChange={setC('full_name')} /></Field>
              <Field label="Téléphone" required error={errors.phone}><input inputMode="tel" autoComplete="tel" placeholder="77 123 45 67" value={customer.phone} onChange={setC('phone')} /></Field>
              <Field label="Identifiant Pi (facultatif)"><input value={customer.pi_username} onChange={setC('pi_username')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Adresse de livraison</h3>
            <div className="fgrid two">
              <Field label="Région" required error={errors.region_id}><select value={addr.region_id} onChange={(e) => setAddr({ ...addr, region_id: e.target.value, department: '' })}><option value="">— Choisir —</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
              <Field label="Département" required error={errors.department}><select value={addr.department} onChange={setA('department')} disabled={!deps.length}><option value="">— Choisir —</option>{deps.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></Field>
              <Field label="Commune / Ville" required error={errors.commune}>
                <input list="communes" value={addr.commune} onChange={setA('commune')} autoComplete="off" />
              </Field>
              {regionName === 'Dakar' && <datalist id="communes">{DAKAR_COMMUNES.map((c) => <option key={c} value={c} />)}</datalist>}
              <Field label="Quartier" required error={errors.quartier}><input value={addr.quartier} onChange={setA('quartier')} /></Field>
            </div>
            <div className="stack mt-s">
              <Field label="Adresse détaillée" required error={errors.address_line}><input value={addr.address_line} onChange={setA('address_line')} placeholder="Villa, rue, numéro…" /></Field>
              <Field label="Point de repère"><input value={addr.landmark} onChange={setA('landmark')} placeholder="Ex : près de la mosquée, en face de la station…" /></Field>
              <div className="row wrap"><button type="button" className="btn btn-sm btn-ghost" onClick={locate}><Navigation size={16} /> {addr.lat ? 'Position ajoutée ✓' : 'Ajouter ma position GPS'}</button><span className="small muted">Facultatif — partagée avec le vendeur uniquement pour la livraison.</span></div>
              {!saved.length && <label className="check"><input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} /> Enregistrer cette adresse pour mes prochaines commandes</label>}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="card">
            <h3>Mode de livraison</h3>
            <div className="radios">
              {Object.entries(MODES).map(([m, label]) => {
                const q = quotes[m]; const Icon = MODE_ICON[m]; const ok = !!q?.can_order;
                return (
                  <label key={m} className={`radiocard ${mode === m ? 'on' : ''} ${ok ? '' : 'disabled'}`}>
                    <input type="radio" name="mode" checked={mode === m} disabled={!ok} onChange={() => setMode(m)} />
                    <Icon size={22} color="var(--turq-d)" />
                    <div className="grow"><b>{label}</b>
                      <div className="small muted">{ok ? (q.delivery_fee ? `${piFmt(q.delivery_fee)} · ${q.sellers.map((s) => s.eta_text).join(' / ')}` : `Gratuit · ${q.sellers[0]?.eta_text || ''}`) : (q?.sellers?.find((s) => !s.served)?.reason || q?.problems?.[0]?.message || 'Non disponible pour cette zone.')}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            {quote && !quote.can_order && <div className="notice warn mt-s"><Info size={18} /><div className="small">{quote.sellers.find((s) => !s.served)?.reason || quote.problems?.[0]?.message || "Ce mode n'est pas disponible dans votre zone."} Choisissez un autre mode ou une autre adresse.</div></div>}
            {quote?.can_order && (mode === 'retrait_vente' || mode === 'retrait_relais') && quote.sellers.map((s) => s.zone?.pickup_address && <div key={s.seller_id} className="notice mt-s small"><Store size={18} /><div><b>Point de retrait ({s.shop_name})</b><br />{s.zone.pickup_address}</div></div>)}
            {quote?.can_order && firstZone?.zone?.conditions && <div className="small muted mt-s">{firstZone.zone.conditions}</div>}
          </div>
          <div className="card"><Field label="Commentaire (facultatif)"><textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} placeholder="Ex : instructions spéciales, préférence de livraison…" /></Field></div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <div className="card">
            <h3>Paiement en Pi (π)</h3>
            <p className="small">Tous les prix sont en Pi. Après la confirmation, la commande est enregistrée et vous la réglez dans Pi Browser avec votre compte Pi. Elle n’est transmise au vendeur qu’une fois le paiement confirmé.</p>
            <div className="small muted mt-s">{piOk ? 'Votre compte Pi est connecté : le paiement s’ouvrira juste après la confirmation.' : !cfg.pi_payment_enabled ? "Le paiement en Pi n'est pas encore activé : votre commande sera enregistrée et restera à payer." : inPiBrowser() ? 'Connectez-vous avec Pi (menu Compte) pour payer. Vous pouvez aussi confirmer maintenant et payer ensuite.' : 'Le paiement se fait dans Pi Browser, avec votre compte Pi. Vous pouvez confirmer maintenant et payer ensuite.'}</div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <div className="card">
            <h3>Récapitulatif de la commande</h3>
            {lines.map((l) => <div className="sumrow" key={l.product_id}><span>{l.product.name} <span className="muted">× {num(l.quantity)} {l.product.unit}</span></span><b>{piFmt(l.line_total)}</b></div>)}
            <div className="sumrow"><span>Sous-total</span><b>{piFmt(quote?.subtotal ?? 0)}</b></div>
            <div className="sumrow"><span>Frais de livraison</span><b>{piFmt(quote?.delivery_fee ?? 0)}</b></div>
            <div className="sumrow total"><span>Total</span><span className="price">{piFmt(total)}</span></div>
            {quote?.sellers?.length > 1 && <div className="notice warn small mt-s"><Info size={18} />Vos produits viennent de {quote.sellers.length} vendeurs : {quote.sellers.length} commandes distinctes seront créées.</div>}
            <div className="small muted mt-s">Les montants sont estimatifs : le vendeur peut confirmer le montant final après pesée.</div>
          </div>
          <div className="card small">
            <h3>Livraison</h3>
            <div><b>{customer.full_name}</b> · {customer.phone}</div>
            <div>{addr.address_line}{addr.landmark ? ` (${addr.landmark})` : ''}</div>
            <div>{addr.quartier}, {addr.commune}, {addr.department}, {regionName}</div>
            <div className="mt-s"><b>{MODES[mode]}</b>{quote?.sellers?.[0]?.eta_text ? ` · délai estimé ${quote.sellers[0].eta_text}` : ''}</div>
            <div><b>Paiement :</b> en Pi (π), après confirmation</div>
            {comment && <div><b>Commentaire :</b> {comment}</div>}
            <button className="btn btn-sm btn-ghost mt-s" onClick={() => setStep(1)}>Modifier mes informations</button>
          </div>
          <div className="card stack">
            <label className="check"><input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} /> Je confirme l’exactitude de mes informations et de mon adresse.</label>
            <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> J’accepte que mes données soient transmises au vendeur pour traiter et livrer ma commande, conformément à la <Link to="/infos/confidentialite" target="_blank">politique de confidentialité</Link> et aux <Link to="/infos/cgv" target="_blank">conditions de vente</Link>.</label>
          </div>
        </div>
      )}

      <div className="paybar">
        <div><div className="small muted">{step === 4 ? 'Total à payer' : 'Total estimé'}</div><div className="price" style={{ fontSize: 20 }}>{piFmt(total)}</div></div>
        <div className="row">
          {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)} aria-label="Étape précédente"><ArrowLeft size={18} /></button>}
          {step < 4
            ? <button className="btn btn-coral" onClick={next} disabled={!canNext}>Valider et continuer <ArrowRight size={18} /></button>
            : <button className="btn btn-coral" onClick={confirm} disabled={busy || !consent || !accurate}>{busy ? 'Envoi…' : 'Confirmer la commande'}</button>}
        </div>
      </div>
    </ScreenShell>
  );
}
