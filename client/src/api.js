const TOKEN_KEY = 'geej_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ } };

export class ApiError extends Error {
  constructor(message, status, code, extra) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}

async function request(method, path, { body, form, signal } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Connexion impossible. Vérifiez votre réseau et réessayez.', 0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) {
    if (res.status === 401 && t && data?.code === 'unauthenticated') window.dispatchEvent(new Event('geej:logout'));
    throw new ApiError(data?.error || 'Une erreur est survenue.', res.status, data?.code, { issues: data?.issues, problems: data?.problems });
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, o),
  post: (p, body, o) => request('POST', p, { body, ...o }),
  put: (p, body) => request('PUT', p, { body }),
  patch: (p, body) => request('PATCH', p, { body }),
  del: (p) => request('DELETE', p),
  upload: (p, form) => request('POST', p, { form }),
};
