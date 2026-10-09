import { useState } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { api, go, fmtDate, STATUS_LABEL } from '../api.js';
import { useLoad, Loading, StatusPill } from '../ui.jsx';
import Sheet from '../Sheet.jsx';

export function Segmented({ value, options, onChange, label }) {
  return (
    <LayoutGroup id={label}>
      <div className="segmented" role="tablist" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} type="button">
            {value === v && <motion.span layoutId="seg" className="seg-thumb" transition={{ type: 'spring', bounce: 0, duration: 0.3 }} />}
            <span className="seg-label">{text}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

export default function CaseWorkspace({ caseId }) {
  const { data: c, error, reload } = useLoad(`/cases/${caseId}`);
  const [filter, setFilter] = useState('active');
  const [history, setHistory] = useState(null);
  const [sheet, setSheet] = useState(null);

  if (!c) return <Loading error={error} retry={reload} />;
  const shown = c.records.filter(r => r.status === filter);
  const counts = { active: c.records.filter(r => r.status === 'active').length, archived: c.records.filter(r => r.status === 'archived').length };

  const openHistory = async r => setHistory(await api(`/cases/${caseId}/records/${encodeURIComponent(r.id)}/versions`));

  return (
    <>
      <a href="#/" className="back">‹ Cases</a>
      <header className="page-head">
        <div>
          <h1 className="display">{c.title}</h1>
          {c.description && <p className="muted">{c.description}</p>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => setSheet('import')}>Import CSV</button>
          <button className="btn" onClick={() => setSheet('add')}>Add record</button>
          <button className="btn primary" onClick={() => go(`/cases/${caseId}/new`)}>New meeting review</button>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>Meeting reviews</h2>
        </div>
        {c.reviews.length ? (
          <ul className="list card">
            {c.reviews.map(r => (
              <li key={r.id}>
                <a href={r.status === 'completed' ? `#/reviews/${r.id}/report` : `#/reviews/${r.id}`} className="list-row">
                  <span className="grow"><strong>{r.title}</strong><span className="muted small"> · {r.meeting_date || 'No date'} · {r.reviewer}</span></span>
                  <StatusPill status={r.status}>{STATUS_LABEL[r.status]}</StatusPill>
                  <span className="muted small">{fmtDate(r.completed_at || r.created_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No meetings reviewed yet. Start with <em>New meeting review</em>.</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Records</h2>
          <Segmented label="Record status" value={filter} onChange={setFilter}
            options={[['active', `Active (${counts.active})`], ['archived', `Archived (${counts.archived})`]]} />
        </div>
        <div className="grid">
          {shown.map(r => (
            <button key={r.id} className="card record-card" onClick={() => openHistory(r)}>
              <div className="meta"><code>{r.id}</code>{r.type && <span>{r.type}</span>}<span>v{r.version}</span></div>
              <h3>{r.title}</h3>
              <p className="muted clamp">{r.content}</p>
              <p className="small muted">{r.source_ref}</p>
            </button>
          ))}
          {!shown.length && <p className="muted">No {filter} records.</p>}
        </div>
      </section>

      <Sheet open={!!history} onClose={() => setHistory(null)} title={history ? `${history.record.title}` : ''}>
        {history && (
          <div className="stack">
            <div className="meta"><code>{history.record.id}</code><span>{history.record.status}</span><span>{history.record.source_ref}</span></div>
            <ol className="versions">
              {history.versions.map(v => (
                <li key={v.version} className="card">
                  <div className="meta"><strong>Version {v.version}</strong><span>{fmtDate(v.created_at)}</span><span>by {v.actor}</span>{v.review_id && <a href={`#/reviews/${v.review_id}`}>Review {v.review_id}</a>}</div>
                  <p>{v.content}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Sheet>

      <ImportSheet open={sheet === 'import'} caseId={caseId} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <AddSheet open={sheet === 'add'} caseId={caseId} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
    </>
  );
}

function ImportSheet({ open, caseId, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setResult(null);
    try { const r = await api(`/cases/${caseId}/import`, { method: 'POST', body: { csv } }); setCsv(''); onDone(r); }
    catch (e) { setResult({ error: e.message, errors: e.data?.errors ?? [] }); }
    finally { setSaving(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Import records from CSV"
      footer={<button className="btn primary" onClick={submit} disabled={saving || !csv.trim()}>{saving ? 'Importing…' : 'Import'}</button>}>
      <div className="stack">
        <p className="muted">Columns: <code>id, title, content, source_ref</code> (optional <code>type</code>). All rows are checked first; nothing is imported if any row has an error.</p>
        <input type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files[0]; if (f) setCsv(await f.text()); }} />
        <textarea rows={8} value={csv} onChange={e => setCsv(e.target.value)} placeholder="id,title,content,source_ref" aria-label="CSV text" />
        {result?.error && (
          <div className="notice error" role="alert">
            <p>{result.error}</p>
            {result.errors.length > 0 && <ul>{result.errors.map(x => <li key={x.line}>Line {x.line}: {x.message}</li>)}</ul>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function AddSheet({ open, caseId, onClose, onDone }) {
  const [f, setF] = useState({ id: '', title: '', type: '', content: '', source_ref: '' });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setErr(null);
    try { await api(`/cases/${caseId}/records`, { method: 'POST', body: f }); setF({ id: '', title: '', type: '', content: '', source_ref: '' }); onDone(); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const field = (k, label, props = {}) => (
    <label className="field"><span>{label}</span>
      {props.rows ? <textarea {...props} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
        : <input {...props} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />}
    </label>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Add record"
      footer={<button className="btn primary" onClick={submit} disabled={saving || !f.title.trim() || !f.content.trim()}>{saving ? 'Saving…' : 'Add record'}</button>}>
      <div className="stack">
        {field('id', 'Record ID (optional — generated if blank)')}
        {field('title', 'Title')}
        {field('type', 'Type (optional)')}
        {field('content', 'Content', { rows: 5 })}
        {field('source_ref', 'Source reference (optional)')}
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}
