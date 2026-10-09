import { useState } from 'react';
import { fmtDate, ACTION_LABEL } from '../api.js';
import { useLoad, Loading, Refs } from '../ui.jsx';

export default function Report({ reviewId }) {
  const { data: r, error, reload } = useLoad(`/reviews/${reviewId}/report`);
  const [active, setActive] = useState(null);
  if (!r) return <Loading error={error} retry={reload} />;
  const open = pid => { setActive(pid); requestAnimationFrame(() => document.getElementById(`para-${pid}`)?.scrollIntoView({ block: 'center' })); };
  const { review, changes } = r;

  return (
    <article className="report">
      <a href={`#/cases/${r.case.id}`} className="back no-print">‹ {r.case.title}</a>
      <header className="page-head">
        <div>
          <p className="eyebrow">Final review report</p>
          <h1 className="display">{review.title}</h1>
          <p className="muted">{r.case.title} · Meeting date {review.meeting_date || 'not specified'} · Reviewer {review.reviewer}</p>
          <p className="muted small">Completed by <strong>{review.completed_by}</strong> on {fmtDate(review.completed_at)} · Analysis {r.analysis.model}, {(r.analysis.duration_ms / 1000).toFixed(1)}s</p>
        </div>
        <button className="btn no-print" onClick={() => print()}>Print</button>
      </header>

      <section className="card">
        <h2>Reviewed summary</h2>
        <p>{r.summary}</p>
        {r.summary !== r.original_summary && <details className="small"><summary>Original AI summary</summary><p>{r.original_summary}</p></details>}
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Meeting decisions</h2>
          {r.decisions.length ? <ul className="bullets">{r.decisions.map((d, i) => <li key={i}>{d.text} <Refs refs={d.refs} onOpen={open} /></li>)}</ul> : <p className="muted">None recorded.</p>}
          <h2>Follow-up items</h2>
          {r.follow_ups.length ? <ul className="bullets">{r.follow_ups.map((f, i) => <li key={i}>{f.text} <span className="small muted">— Owner: {f.owner || 'unspecified'} · Due: {f.due || 'unspecified'}</span> <Refs refs={f.refs} onOpen={open} /></li>)}</ul> : <p className="muted">None.</p>}
          <h2>Remaining questions</h2>
          {r.questions.length ? <ul className="bullets">{r.questions.map((q, i) => <li key={i}>{q.text} <Refs refs={q.refs} onOpen={open} /></li>)}</ul> : <p className="muted">None.</p>}
        </section>

        <section className="card">
          <h2>Record changes</h2>
          {[['added', 'Added'], ['updated', 'Updated'], ['archived', 'Archived'], ['retained', 'Retained']].map(([k, label]) => (
            <div key={k}>
              <h3>{label} ({changes[k].length})</h3>
              {changes[k].length ? <ul className="bullets">{changes[k].map((c, i) => c && (
                <li key={i}><code>{c.record_id}</code> {c.title} <span className="muted small">v{c.version}{c.previous_version ? ` (was v${c.previous_version})` : ''}</span></li>
              ))}</ul> : <p className="muted small">None.</p>}
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <h2>Suggestions and reviewer outcomes</h2>
        {r.suggestions.length ? (
          <table className="table">
            <thead><tr><th>ID</th><th>AI suggestion</th><th>Evidence</th><th>Outcome</th><th>Reviewer reason</th></tr></thead>
            <tbody>
              {r.suggestions.map(s => (
                <tr key={s.id}>
                  <td><code>{s.id.split('-').pop()}</code></td>
                  <td><strong>{ACTION_LABEL[s.action]}</strong> {s.title}{s.target_record_id && <> (<code>{s.target_record_id}</code>)</>}<div className="small muted">{s.reason}</div></td>
                  <td><Refs refs={s.refs} onOpen={open} /></td>
                  <td>{ACTION_LABEL[s.decision.chosen_action]}{s.decision.chosen_action !== s.action && <span className="pill warn small">override</span>}</td>
                  <td>{s.decision.reason}<div className="small muted">{s.decision.actor} · {fmtDate(s.decision.created_at)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">The analysis proposed no record changes.</p>}
        {r.analysis.discarded > 0 && <p className="small muted">{r.analysis.discarded} AI suggestion(s) were discarded for lacking valid transcript references.</p>}
      </section>

      <section className="card">
        <h2>Audit history</h2>
        <ol className="audit">
          {r.audit.map(e => (
            <li key={e.id}>
              <time>{fmtDate(e.ts)}</time>
              <span><strong>{e.action}</strong>{e.target && <> · <code>{e.target}</code></>}{e.before_version != null && <> · v{e.before_version} → v{e.after_version}</>}{e.outcome && <> · {e.outcome}</>}</span>
              <span className="muted small">{e.actor}{e.suggestion_id && ` · ${e.suggestion_id.split('-').pop()}`}{e.detail?.reason && ` · “${e.detail.reason}”`}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Transcript</h2>
        <ol className="paragraphs">
          {r.paragraphs.map(p => <li key={p.id} id={`para-${p.id}`} className={active === p.id ? 'hit' : ''}><span className="pid">{p.id}</span><p>{p.text}</p></li>)}
        </ol>
      </section>
    </article>
  );
}
