import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => api(path).then(d => { setData(d); setError(null); return d; }, setError), [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload, setData };
}

export function Loading({ error, retry }) {
  if (error) return (
    <div className="card notice error" role="alert">
      <p>{error.message}</p>
      {retry && <button className="btn" onClick={retry}>Try again</button>}
    </div>
  );
  return <p className="muted loading" aria-live="polite">Loading…</p>;
}

export function StatusPill({ status, children }) {
  return <span className={`pill status-${status}`}>{children}</span>;
}

export function Refs({ refs, onOpen }) {
  if (!refs?.length) return null;
  return (
    <span className="refs">
      {refs.map(r => (
        <button key={r} type="button" className="ref" onClick={() => onOpen?.(r)} aria-label={`Open transcript paragraph ${r}`}>¶ {r}</button>
      ))}
    </span>
  );
}
