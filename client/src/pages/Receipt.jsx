// Reçu de paiement en Pi: à garder (capture d'écran / image / PDF) et à présenter à la livraison.
import { useParams, Link } from 'react-router-dom';
import { Download, Printer, ReceiptText } from 'lucide-react';
import { api } from '../api.js';
import { piFmt, dateFr, num } from '../util.js';
import { ScreenShell } from '../components/Layout.jsx';
import { Spinner, ErrorBox, useAsync } from '../components/ui.jsx';

function lines(r) {
  const out = [
    ['GÉEJ MARKET — Reçu de paiement', 'title'], ['', ''],
    [`Commande : ${r.order_no}`, 'b'], [`Code de contrôle : ${r.code}`, 'b'], [`Payé le : ${dateFr(r.paid_at)}`, ''],
    [`Vendeur : ${r.shop_name}`, ''], [`Client : ${r.customer_name}`, ''], ['', ''],
  ];
  r.items.forEach((i) => out.push([`${i.product_name}  ${num(i.quantity)} ${i.unit} × ${piFmt(i.unit_price)} = ${piFmt(i.line_total)}`, '']));
  out.push(['', ''], [`TOTAL PAYÉ : ${piFmt(r.final_total ?? r.total)}`, 'b'], [`Transaction Pi : ${(r.txid || '').slice(0, 24)}…`, 'small'], ['', ''],
    ['Présentez ce reçu à la livraison pour recevoir votre commande.', 'small']);
  return out;
}

function downloadPng(r) {
  const L = lines(r); const W = 900; const H = 80 + L.length * 44;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#10354D'; g.fillRect(0, 0, W, 14);
  let y = 60;
  for (const [t, k] of L) {
    g.fillStyle = k === 'small' ? '#555' : '#10354D';
    g.font = `${k === 'title' ? '700 30px' : k === 'b' ? '700 26px' : k === 'small' ? '20px' : '24px'} system-ui, sans-serif`;
    g.fillText(t, 40, y, W - 80); y += 44;
  }
  const a = document.createElement('a'); a.download = `recu-${r.order_no}.png`; a.href = c.toDataURL('image/png'); a.click();
}

export default function Receipt() {
  const { id } = useParams();
  const { data, loading, error } = useAsync(() => api.get(`/api/orders/${id}/receipt`), [id]);
  const r = data?.receipt;
  return (
    <ScreenShell title="Reçu de paiement" back={`/commandes/${id}`}>
      <div style={{ maxWidth: 560, margin: '0 auto' }} className="stack">
        {loading && <Spinner />}{error && <ErrorBox error={error} />}
        {r && (
          <>
            <div className="card stack receipt" id="receipt">
              <div className="row"><ReceiptText size={26} color="var(--turq-d)" /><b style={{ fontSize: 18 }}>Reçu de paiement en Pi</b></div>
              <div className="sumrow"><span>Commande</span><b>{r.order_no}</b></div>
              <div className="sumrow"><span>Code de contrôle</span><b style={{ letterSpacing: 1 }}>{r.code}</b></div>
              <div className="sumrow"><span>Payé le</span><b>{dateFr(r.paid_at)}</b></div>
              <div className="sumrow"><span>Vendeur</span><b>{r.shop_name}</b></div>
              <div className="sumrow"><span>Client</span><b>{r.customer_name}</b></div>
              <hr />
              {r.items.map((i, k) => <div className="sumrow" key={k}><span>{i.product_name} <span className="muted small">{num(i.quantity)} {i.unit} × {piFmt(i.unit_price)}</span></span><b>{piFmt(i.line_total)}</b></div>)}
              <div className="sumrow total"><span>Total payé</span><span className="price">{piFmt(r.final_total ?? r.total)}</span></div>
              <div className="small muted" style={{ wordBreak: 'break-all' }}>Transaction Pi : {r.txid}</div>
            </div>
            <div className="notice">Gardez ce reçu (capture d’écran ou image). À la livraison, présentez-le : le vendeur le vérifie avec le numéro de commande et le code de contrôle.</div>
            <div className="row wrap">
              <button className="btn btn-primary grow" onClick={() => downloadPng(r)}><Download size={18} /> Télécharger l’image</button>
              <button className="btn btn-ghost grow" onClick={() => window.print()}><Printer size={18} /> Imprimer / PDF</button>
            </div>
            <Link className="small" to={`/compte/reclamations?commande=${r.id}`}>Un problème avec cette commande ? Déposer une plainte</Link>
          </>
        )}
      </div>
    </ScreenShell>
  );
}
