import { lazy, Suspense, useState } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Home from './pages/Home.jsx';
import Categories from './pages/Categories.jsx';
import Catalog from './pages/Catalog.jsx';
import Product from './pages/Product.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import { OrdersList, OrderDetail } from './pages/Orders.jsx';
import { PiGate, StaffLogin, AccountHome, AccountRoutes } from './pages/Account.jsx';
import { useAuth } from './state.jsx';
import Info from './pages/Info.jsx';
import { Spinner } from './components/ui.jsx';

const Seller = lazy(() => import('./seller/SellerApp.jsx'));
const Admin = lazy(() => import('./admin/AdminApp.jsx'));

function ScrollTop() { const { pathname } = useLocation(); useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]); return null; }

import Receipt from './pages/Receipt.jsx';

// Page de bienvenue: quelques secondes à l'ouverture du lien (une fois par session), puis disparition automatique.
function Splash() {
  const seen = (() => { try { return sessionStorage.getItem('geej_splash') === '1'; } catch { return false; } })();
  const [phase, setPhase] = useState(seen ? 'gone' : 'show');
  useEffect(() => {
    if (phase === 'gone') return undefined;
    try { sessionStorage.setItem('geej_splash', '1'); } catch { /* ignoré */ }
    const t1 = setTimeout(() => setPhase('fade'), 2600);
    const t2 = setTimeout(() => setPhase('gone'), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (phase === 'gone') return null;
  return (
    <div className={`splash ${phase === 'fade' ? 'out' : ''}`} role="presentation" aria-hidden="true">
      <div className="splash-in">
        <div className="splash-wave" />
        <h1>GÉEJ MARKET</h1>
        <p>Le marché de la mer</p>
        <small>Bienvenue</small>
      </div>
    </div>
  );
}

// Avant toute chose, le pionnier se connecte avec son compte Pi. Restent ouverts: infos légales et accès équipe.
function Gate({ children }) {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  const open = pathname.startsWith('/infos/') || pathname === '/equipe' || pathname.startsWith('/vendeur') || pathname.startsWith('/admin');
  if (!ready) return <Spinner />;
  if (!user && !open) return <PiGate />;
  return children;
}
export default function App() {
  return (
    <>
      <ScrollTop />
      <Splash />
      <Gate>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/produits" element={<Catalog />} />
          <Route path="/produit/:id" element={<Product />} />
          <Route path="/panier" element={<Cart />} />
          <Route path="/commander" element={<Checkout />} />
          <Route path="/commandes" element={<OrdersList />} />
          <Route path="/commandes/:id" element={<OrderDetail />} />
          <Route path="/commandes/:id/recu" element={<Receipt />} />
          <Route path="/connexion" element={<Navigate to="/" replace />} />
          <Route path="/inscription" element={<Navigate to="/" replace />} />
          <Route path="/equipe" element={<StaffLogin />} />
          <Route path="/compte" element={<AccountHome />} />
          <Route path="/compte/*" element={<AccountRoutes />} />
          <Route path="/infos/:page" element={<Info />} />
          <Route path="/vendeur/*" element={<Seller />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </Gate>
    </>
  );
}
