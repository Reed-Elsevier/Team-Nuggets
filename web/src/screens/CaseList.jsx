import { useState } from 'react';
import { motion } from 'framer-motion';
import { api, go, fmtDate } from '../api.js';
import { useLoad, Loading } from '../ui.jsx';
import Sheet from '../Sheet.jsx';

export default function CaseList() {
  const { data: cases, error, reload } = useLoad('/cases');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const create = async e => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const c = await api('/cases', { method: 'POST', body: form });
      go(`/cases/${c.id}`);
    } catch (x) { setErr(x.message); } finally { setSaving(false); }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="display">Cases</h1>
          <p className="muted">Select a case to review its records and meetings.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>New case</button>
      </header>

      {!cases ? <Loading error={error} retry={reload} /> : (
        <div className="grid">
          {cases.map((c, i) => (
            <motion.a key={c.id} href={`#/cases/${c.id}`} className="card case-card"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: i * 0.04 }}>
              <h2>{c.title}</h2>
              {c.description && <p className="muted clamp">{c.description}</p>}
              <div className="meta">
                <span>{c.active_records} active</span>
                <span>{c.archived_records} archived</span>
                <span>{c.reviews} reviews</span>
                <span>Created {fmtDate(c.created_at)}</span>
              </div>
            </motion.a>
          ))}
          {!cases.length && <p className="muted">No cases yet.</p>}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New case"
        footer={<button className="btn primary" form="new-case" disabled={saving || !form.title.trim()}>{saving ? 'Creating…' : 'Create case'}</button>}>
        <form id="new-case" onSubmit={create} className="stack">
          <label className="field"><span>Title</span>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          </label>
          <label className="field"><span>Description</span>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </label>
          {err && <p className="error-text" role="alert">{err}</p>}
        </form>
      </Sheet>
    </>
  );
}
