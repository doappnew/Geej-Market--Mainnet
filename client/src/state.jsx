import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { handleIncomplete } from './pi.js';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((message, kind = '') => {
    const id = Math.random();
    setList((l) => [...l.slice(-2), { id, message, kind }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- Configuration publique ---------- */
const ConfigCtx = createContext({});
export const useConfig = () => useContext(ConfigCtx);
export function ConfigProvider({ children }) {
  const [cfg, setCfg] = useState({});
  useEffect(() => { api.get('/api/config').then(setCfg).catch(() => {}); }, []);
  return <ConfigCtx.Provider value={cfg}>{children}</ConfigCtx.Provider>;
}

/* ---------- Authentification ---------- */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const mergeHook = useRef(null);

  useEffect(() => {
    if (!getToken()) return;
    api.get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const out = () => { setToken(null); setUser(null); };
    window.addEventListener('geej:logout', out);
    return () => window.removeEventListener('geej:logout', out);
  }, []);

  const signIn = useCallback(async ({ token, user: u, incomplete }) => {
    setToken(token); setUser(u);
    await mergeHook.current?.();
    if (incomplete) handleIncomplete(incomplete);
  }, []);
  const signOut = useCallback(() => { setToken(null); setUser(null); }, []);
  const value = useMemo(() => ({ user, ready, signIn, signOut, setUser, setMergeHook: (f) => { mergeHook.current = f; } }), [user, ready, signIn, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ---------- Panier (invité: appareil; connecté: serveur) ---------- */
const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);
const LOCAL = 'geej_cart';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } };
const writeLocal = (items) => { try { localStorage.setItem(LOCAL, JSON.stringify(items)); } catch { /* ignoré */ } };

export function CartProvider({ children }) {
  const { user, ready, setMergeHook } = useAuth();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  const hydrateGuest = useCallback(async () => {
    const raw = readLocal();
    const out = [];
    await Promise.all(raw.map(async (it) => {
      try { const { product } = await api.get(`/api/products/${it.product_id}`); out.push({ product_id: it.product_id, quantity: it.quantity, product, line_total: Math.round(product.effective_price * it.quantity) }); } catch { /* produit retiré */ }
    }));
    out.sort((a, b) => raw.findIndex((r) => r.product_id === a.product_id) - raw.findIndex((r) => r.product_id === b.product_id));
    setLines(out); writeLocal(out.map((l) => ({ product_id: l.product_id, quantity: l.quantity })));
  }, []);

  const loadServer = useCallback(async () => { const r = await api.get('/api/cart'); setLines(r.items); }, []);

  const mergeGuestIntoAccount = useCallback(async () => {
    const raw = readLocal();
    if (raw.length) {
      try { await api.post('/api/cart/merge', { items: raw }); } catch { /* ignoré */ }
      writeLocal([]);
    }
    await loadServer();
  }, [loadServer]);
  useEffect(() => { setMergeHook(mergeGuestIntoAccount); }, [setMergeHook, mergeGuestIntoAccount]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    (user ? loadServer() : hydrateGuest()).catch(() => {}).finally(() => setLoading(false));
  }, [user?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = useCallback(async (product, quantity) => {
    const q = +Number(quantity).toFixed(3);
    if (user) {
      try {
        const r = await api.put('/api/cart/items', { product_id: product.id, quantity: q });
        setLines(r.items);
        if (r.clamped) toast(`Quantité ajustée au stock disponible (${r.quantity} ${product.unit}).`);
        return true;
      } catch (e) { toast(e.message, 'bad'); return false; }
    }
    const max = Math.floor(Number(product.stock) / product.qty_step + 1e-9) * product.qty_step;
    let qq = q;
    if (qq > max) { qq = +max.toFixed(3); toast(`Quantité ajustée au stock disponible (${qq} ${product.unit}).`); }
    setLines((cur) => {
      const next = qq <= 0 ? cur.filter((l) => l.product_id !== product.id)
        : cur.some((l) => l.product_id === product.id) ? cur.map((l) => (l.product_id === product.id ? { ...l, quantity: qq, product, line_total: Math.round(product.effective_price * qq) } : l))
          : [...cur, { product_id: product.id, quantity: qq, product, line_total: Math.round(product.effective_price * qq) }];
      writeLocal(next.map((l) => ({ product_id: l.product_id, quantity: l.quantity })));
      return next;
    });
    return true;
  }, [user, toast]);

  const add = useCallback(async (product, quantity) => {
    const existing = lines.find((l) => l.product_id === product.id)?.quantity || 0;
    const ok = await setQty(product, existing + (quantity ?? product.min_qty));
    if (ok) toast(`${product.name} ajouté au panier`, 'ok');
    return ok;
  }, [lines, setQty, toast]);
  const remove = useCallback((product) => setQty(product, 0), [setQty]);
  const clear = useCallback(async () => {
    if (user) await api.del('/api/cart').catch(() => {}); else writeLocal([]);
    setLines([]);
  }, [user]);
  const reload = useCallback(() => (user ? loadServer() : hydrateGuest()), [user, loadServer, hydrateGuest]);

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const value = useMemo(() => ({ lines, loading, count: lines.length, subtotal, add, setQty, remove, clear, reload }), [lines, loading, subtotal, add, setQty, remove, clear, reload]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
