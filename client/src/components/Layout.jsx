import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Home, LayoutGrid, ShoppingCart, ClipboardList, User, Search, Bell, ArrowLeft, SlidersHorizontal, Store, ShieldCheck } from 'lucide-react';
import { useAuth, useCart } from '../state.jsx';
import { api } from '../api.js';
import { useAsync } from './ui.jsx';

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="GÉEJ MARKET — accueil">
      <img src="/logo.svg" alt="" width="42" height="42" />
      <div><b>GÉEJ <span>MARKET</span></b><small>LE MARCHÉ DE LA MER</small></div>
    </Link>
  );
}

function useUnread() {
  const { user } = useAuth();
  const { data } = useAsync(() => (user ? api.get('/api/me/notifications') : Promise.resolve({ unread: 0 })), [user?.id]);
  return data?.unread || 0;
}

export function SearchBar({ initial = '' }) {
  const nav = useNavigate();
  const [q, setQ] = useState(initial);
  return (
    <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/produits?q=${encodeURIComponent(q.trim())}`); }}>
      <Search size={19} aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit, une catégorie…" aria-label="Rechercher" enterKeyHint="search" />
      <button type="button" aria-label="Filtres" onClick={() => nav(`/produits?q=${encodeURIComponent(q.trim())}&filtres=1`)}><SlidersHorizontal size={20} /></button>
    </form>
  );
}

export function TopBar() {
  const { count } = useCart();
  const unread = useUnread();
  const { user } = useAuth();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="topbar-row">
          <Brand />
          <nav className="deskmenu desk-only" aria-label="Navigation">
            <NavLink to="/" end>Accueil</NavLink><NavLink to="/categories">Catégories</NavLink><NavLink to="/produits">Produits</NavLink><NavLink to="/commandes">Commandes</NavLink>
          </nav>
          <div className="grow desk-only" />
          <div className="desk-only"><SearchBar /></div>
          {user?.role === 'seller' && <Link className="iconbtn desk-only" to="/vendeur" aria-label="Espace vendeur" title="Espace vendeur"><Store size={22} /></Link>}
          {user?.role === 'admin' && <Link className="iconbtn desk-only" to="/admin" aria-label="Administration" title="Administration"><ShieldCheck size={22} /></Link>}
          <Link to="/compte/notifications" className="iconbtn" aria-label="Notifications"><Bell size={23} />{unread > 0 && <span className="dot">{unread}</span>}</Link>
          <Link to="/panier" className="iconbtn" aria-label="Panier"><ShoppingCart size={23} />{count > 0 && <span className="dot">{count}</span>}</Link>
          <Link to="/compte" className="iconbtn desk-only" aria-label="Mon compte"><User size={23} /></Link>
        </div>
        <div className="mobile-search mobile-only"><SearchBar /></div>
      </div>
    </header>
  );
}

export function SubBar({ title, back, right }) {
  const nav = useNavigate();
  return (
    <header className="subbar">
      <div className="subbar-in">
        <div className="side"><button className="iconbtn" aria-label="Retour" onClick={() => (back ? nav(back) : nav(-1))}><ArrowLeft size={23} /></button></div>
        <h1>{title}</h1>
        <div className="side">{right}</div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { count } = useCart();
  const loc = useLocation();
  const on = (p, exact) => (exact ? loc.pathname === p : loc.pathname.startsWith(p));
  return (
    <nav className="bottomnav" aria-label="Navigation principale">
      <Link to="/" className={on('/', true) ? 'on' : ''}><Home size={24} />Accueil</Link>
      <Link to="/categories" className={on('/categories') ? 'on' : ''}><LayoutGrid size={24} />Catégories</Link>
      <Link to="/panier" className={`cart ${on('/panier') ? 'on' : ''}`}><ShoppingCart size={24} />Panier{count > 0 && <span className="dot">{count}</span>}</Link>
      <Link to="/commandes" className={on('/commandes') ? 'on' : ''}><ClipboardList size={24} />Commandes</Link>
      <Link to="/compte" className={on('/compte') || on('/connexion') || on('/inscription') ? 'on' : ''}><User size={24} />Compte</Link>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div>
          <h4>GÉEJ MARKET</h4>
          <p style={{ margin: 0 }}>Le marché de la mer. Poissons, crustacés, mollusques et produits transformés, commandés depuis votre téléphone et livrés au Sénégal.</p>
          <p className="small" style={{ opacity: 0.8 }}>L’authenticité de nos mers, la qualité à votre portée.</p>
        </div>
        <div><h4>Informations</h4><Link to="/infos/livraison">Livraisons</Link><Link to="/infos/conditions">Conditions d’utilisation</Link><Link to="/infos/cgv">Conditions générales de vente</Link><Link to="/infos/confidentialite">Politique de confidentialité</Link><Link to="/infos/legal">Informations légales</Link></div>
        <div><h4>Assistance</h4><Link to="/compte/reclamations">Réclamation</Link><Link to="/infos/contact">Nous contacter</Link></div>
        
      </div>
    </footer>
  );
}

// Page "client": barre haute marque + navigation basse
export function ClientShell({ children }) {
  return (<div className="shell"><TopBar /><main>{children}</main><Footer /><BottomNav /></div>);
}
// Page "écran" avec barre de titre
export function ScreenShell({ title, back, right, children }) {
  return (<div className="shell"><SubBar title={title} back={back} right={right} /><main>{children}</main><BottomNav /></div>);
}
