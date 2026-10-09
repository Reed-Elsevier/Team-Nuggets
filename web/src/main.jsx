import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig, motion, AnimatePresence } from 'framer-motion';
import { reviewer, api } from './api.js';
import CaseList from './screens/CaseList.jsx';
import CaseWorkspace from './screens/CaseWorkspace.jsx';
import NewReview from './screens/NewReview.jsx';
import Review from './screens/Review.jsx';
import Report from './screens/Report.jsx';
import './styles.css';

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => { setHash(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function route(hash, config) {
  let m;
  if ((m = hash.match(/^\/cases\/([^/]+)\/new$/))) return <NewReview caseId={m[1]} config={config} />;
  if ((m = hash.match(/^\/cases\/([^/]+)$/))) return <CaseWorkspace caseId={m[1]} />;
  if ((m = hash.match(/^\/reviews\/([^/]+)\/report$/))) return <Report reviewId={m[1]} />;
  if ((m = hash.match(/^\/reviews\/([^/]+)$/))) return <Review reviewId={m[1]} config={config} />;
  return <CaseList />;
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="4" fill="currentColor" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".55" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" opacity=".25" />
    </svg>
  );
}

function ReviewerGate({ onDone }) {
  const [name, setName] = useState('');
  return (
    <main className="gate">
      <motion.form className="card gate-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
        onSubmit={e => { e.preventDefault(); if (name.trim()) { reviewer.set(name); onDone(); } }}>
        <div className="brand big"><Logo /> RippleWise</div>
        <p className="muted">Trace what a meeting decided to the case records it affects — then review, confirm and audit every change.</p>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ana Reyes" autoFocus required />
        </label>
        <p className="hint">Demo mode — no sign-in. Your name is recorded as the reviewer on every action.</p>
        <button className="btn primary" disabled={!name.trim()}>Continue</button>
      </motion.form>
    </main>
  );
}

function App() {
  const hash = useHash();
  const [who, setWho] = useState(reviewer.get());
  const [config, setConfig] = useState(null);
  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);

  if (!who) return <ReviewerGate onDone={() => setWho(reviewer.get())} />;
  return (
    <>
      <nav className="toolbar">
        <a className="brand" href="#/"><Logo /> RippleWise</a>
        <div className="toolbar-right">
          {config && !config.ai_configured && <span className="pill warn" title="Set BEDROCK_API_KEY in .env">AI key not configured</span>}
          <span className="pill">Demo mode · {who}</span>
          <button className="btn ghost small" onClick={() => { localStorage.removeItem('rw.reviewer'); setWho(''); }}>Switch</button>
        </div>
      </nav>
      <AnimatePresence mode="wait" initial={false}>
        <motion.main key={hash} className="page"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}>
          {route(hash, config)}
        </motion.main>
      </AnimatePresence>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
