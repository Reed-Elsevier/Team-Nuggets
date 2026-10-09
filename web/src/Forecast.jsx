import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';

const DEBOUNCE_MS = 650;
const SPRING = { type: 'spring', bounce: 0, duration: 0.35 };
const SECTIONS = [
  ['impact', 'Potential case impact'],
  ['risks', 'Possible risks'],
  ['next_steps', 'Suggested next steps'],
];
const narrowQuery = '(max-width: 1100px)';

// One panel, refreshed in place. `signature` changes only when a decision changes, not while typing notes.
export default function ForecastPanel({ reviewId, drafts, signature }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState(() => !matchMedia(narrowQuery).matches);
  const seq = useRef(0);
  const latestDrafts = useRef(drafts);
  latestDrafts.current = drafts;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setUpdating(true);
    try {
      const r = await api(`/reviews/${reviewId}/forecast`, { method: 'POST', body: { drafts: latestDrafts.current } });
      if (id !== seq.current) return; // a newer decision superseded this request
      setResult(r);
      setError(null);
    } catch (e) {
      if (id === seq.current) setError(e.message);
    } finally {
      if (id === seq.current) setUpdating(false);
    }
  }, [reviewId]);

  useEffect(() => {
    const t = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [signature, run]);

  const f = result?.status === 'ok' ? result.forecast : null;

  return (
    <section className="card forecast" aria-labelledby="forecast-title" aria-busy={updating}>
      <button type="button" className="forecast-head" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="forecast-body">
        <span className="forecast-title" id="forecast-title">Impact forecast</span>
        <AnimatePresence>
          {updating && (
            <motion.span key="upd" className="updating small" role="status"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <span className="pulse" aria-hidden="true" />Updating forecast…
            </motion.span>
          )}
        </AnimatePresence>
        <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">›</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div id="forecast-body" key="body" className="forecast-body"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={SPRING}>
            <p className="ai-label">AI-generated possible impacts, not confirmed outcomes.</p>

            {error && (
              <div className="notice error small" role="alert">
                <p>Forecast unavailable: {error}</p>
                <button className="btn small" onClick={run} disabled={updating}>Retry</button>
              </div>
            )}

            {!result && !error && <p className="muted small">Loading forecast…</p>}

            {result?.status === 'empty' && (
              <p className="muted">Start reviewing recommendations to see potential case impacts.</p>
            )}

            {f && (
              <motion.div key={result.generated_at} initial={{ opacity: 0.4 }} animate={{ opacity: updating ? 0.55 : 1 }} transition={{ duration: 0.25 }}>
                {SECTIONS.map(([k, label]) => (
                  <div key={k} className="forecast-section">
                    <h3>{label}</h3>
                    {f[k].length ? <ul className="bullets">{f[k].map((b, i) => <li key={i}>{b}</li>)}</ul> : <p className="muted small">Nothing notable.</p>}
                  </div>
                ))}
                <p className="small muted">
                  Based on {result.based_on.confirmed} confirmed and {result.based_on.drafts} draft decision{result.based_on.drafts === 1 ? '' : 's'}.
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
