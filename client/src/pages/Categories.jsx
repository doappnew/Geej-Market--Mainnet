import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ClientShell } from '../components/Layout.jsx';
import { useAsync, ErrorBox, Spinner } from '../components/ui.jsx';

export default function Categories() {
  const { data, loading, error } = useAsync(() => api.get('/api/categories'), []);
  return (
    <ClientShell>
      <h1 style={{ fontSize: 22, color: 'var(--ocean)', marginBottom: 12 }}>Catégories</h1>
      {loading && <Spinner />}{error && <ErrorBox error={error} />}
      <div className="grid">
        {data?.categories.map((c) => (
          <Link key={c.id} to={`/produits?categorie=${c.slug}`} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--ink)' }}>
            <img src={c.image_url} alt="" width="64" height="64" style={{ borderRadius: 16, objectFit: 'cover' }} />
            <div><b>{c.name}</b><div className="muted small">{c.product_count} produit(s)</div></div>
          </Link>
        ))}
      </div>
    </ClientShell>
  );
}
