import { NavLink, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../state.jsx';
import { Spinner } from './ui.jsx';

export function BackOffice({ role, title, nav, children }) {
  const { user, ready, signOut } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/equipe" state={{ from: role === 'admin' ? '/admin' : '/vendeur' }} replace />;
  if (user.role !== role) {
    return (
      <div className="bo-main" style={{ maxWidth: 520, marginTop: 60 }}>
        <div className="card center"><h1 style={{ fontSize: 20 }}>Accès réservé</h1><p className="muted">Ce compte n’a pas accès à {role === 'admin' ? 'l’administration' : 'l’espace vendeur'}.</p><Link className="btn btn-primary" to="/">Retour à la boutique</Link></div>
      </div>
    );
  }
  return (
    <div className="bo">
      <div className="bo-top">
        <Link to="/" className="brand" aria-label="Retour à la boutique"><img src="/logo.svg" alt="" /><div><b>GÉEJ <span>MARKET</span></b></div></Link>
        <span className="role">{title}</span><div className="grow" />
        <span className="small desk-only">{user.full_name}</span>
        <Link to="/" className="btn btn-sm btn-ghost">Boutique</Link>
        <button className="btn btn-sm btn-ghost" onClick={signOut}>Sortir</button>
      </div>
      <nav className="bo-nav" aria-label={title}>{nav.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}</nav>
      <div className="bo-main">{children}</div>
    </div>
  );
}

export const Kpi = ({ label, value, accent, warn }) => <div className={`kpi ${accent ? 'accent' : ''} ${warn ? 'warn' : ''}`}><small>{label}</small><b>{value}</b></div>;

export function Bars({ data, field = 'orders', label = 'day' }) {
  const max = Math.max(1, ...data.map((d) => d[field]));
  return (
    <>
      <div className="bars" style={{ paddingTop: 20 }}>{data.map((d) => <div key={d[label]} style={{ height: `${(d[field] / max) * 100}%` }} title={`${d[label]} : ${d[field]}`}>{d[field] > 0 && <span>{d[field]}</span>}</div>)}</div>
      <div className="barlabels">{data.map((d) => <span key={d[label]}>{d[label].slice(8)}</span>)}</div>
    </>
  );
}
