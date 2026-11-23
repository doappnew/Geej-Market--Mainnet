import { Link } from 'react-router-dom';
import { ChevronRight, ShieldCheck, Truck, Wallet, Headphones, MapPin } from 'lucide-react';
import { api } from '../api.js';
import { piFmt } from '../util.js';
import { ClientShell } from '../components/Layout.jsx';
import { ProductCard, ProductGridSkeleton, useAsync, ErrorBox } from '../components/ui.jsx';

function Section({ title, to, items }) {
  if (!items?.length) return null;
  return (
    <section>
      <div className="sectionhead"><h2>{title}</h2><Link to={to}>Voir tout <ChevronRight size={16} /></Link></div>
      <div className="hscroll">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </section>
  );
}

export default function Home() {
  const { data, loading, error } = useAsync(() => api.get('/api/home'), []);
  const served = useAsync(() => api.get('/api/geo/served'), []);
  const regions = served.data?.served || [];
  const minFee = regions.length ? Math.min(...regions.map((r) => r.min_fee)) : null;

  return (
    <ClientShell>
      <section className="hero" style={{ backgroundImage: "url('/img/hero.jpg')" }}>
        <div className="hero-in">
          <small>Fraîcheur &amp; qualité</small>
          <h1>Découvrez les meilleurs produits de la mer</h1>
          <p>Commandez facilement depuis votre téléphone et faites-vous livrer.</p>
          <Link to="/produits" className="btn btn-primary">Découvrir nos produits</Link>
        </div>
      </section>

      <div className="sectionhead"><h2>Nos catégories</h2><Link to="/categories">Voir tout <ChevronRight size={16} /></Link></div>
      {error && <ErrorBox error={error} />}
      <div className="cats">
        {(data?.categories || Array.from({ length: 4 })).map((c, i) => c ? (
          <Link key={c.id} to={`/produits?categorie=${c.slug}`} className="cat"><div className="img"><img src={c.image_url} alt="" loading="lazy" /></div>{c.name}</Link>
        ) : <div key={i} className="skeleton" style={{ height: 110 }} />)}
      </div>

      {loading && <><div className="sectionhead"><h2>Produits populaires</h2></div><ProductGridSkeleton /></>}
      {data && (() => {
        // Chaque produit n'apparaît qu'une seule fois sur l'accueil (les rubriques se recoupent quand le catalogue est petit).
        const seen = new Set();
        const uniq = (list) => (list || []).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
        const popular = uniq(data.popular); const promos = uniq(data.promos); const recent = uniq(data.recent); const featured = uniq(data.featured);
        return (
          <>
            <Section title="Produits populaires" to="/produits?tri=popular" items={popular} />
            <Section title="Promotions" to="/produits?promo=1" items={promos} />
            <Section title="Nouveautés" to="/produits?tri=new" items={recent} />
            <Section title="Sélection du vendeur" to="/produits?selection=1" items={featured} />
          </>
        );
      })()}

      <div className="banner mt">
        <div className="ic"><Truck size={24} /></div>
        <div className="grow">
          <b>{regions.length ? `Livraison à ${regions.slice(0, 4).map((r) => r.name).join(', ')}${regions.length > 4 ? '…' : ''}` : 'Livraison au Sénégal'}</b>
          <div className="small muted">{minFee != null ? `Frais de livraison à partir de ${piFmt(minFee)}` : 'Zones de livraison bientôt disponibles'}</div>
        </div>
        <Link to="/infos/livraison" className="btn btn-sm btn-primary">En savoir plus</Link>
      </div>

      <div className="trust">
        <div><ShieldCheck size={26} /><p style={{ margin: 0 }}><b>Produits sélectionnés</b><span>Fraîcheur &amp; traçabilité indiquées</span></p></div>
        <div><MapPin size={26} /><p style={{ margin: 0 }}><b>Zones de livraison</b><span>{regions.length ? `${regions.length} région(s) desservie(s)` : 'Selon les vendeurs'}</span></p></div>
        <div><Wallet size={26} /><p style={{ margin: 0 }}><b>Paiement</b><span>Paiement en Pi (π)</span></p></div>
        <div><Headphones size={26} /><p style={{ margin: 0 }}><b>Service client</b><span>Réclamations en ligne</span></p></div>
      </div>
    </ClientShell>
  );
}
