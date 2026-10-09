import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, go, fmtDate, STATUS_LABEL, ACTION_LABEL } from '../api.js';
import { useLoad, Loading, StatusPill, Refs } from '../ui.jsx';
import { Segmented } from './CaseWorkspace.jsx';
import Sheet from '../Sheet.jsx';

const OUTCOMES = {
  archive: ['archive', 'retain'],
  update: ['update', 'retain'],
  add: ['add', 'dismiss'],
  needs_review: ['add', 'update', 'archive', 'no_change'],
};
const SPRING = { type: 'spring', bounce: 0, duration: 0.35 };
const shortId = id => id.split('-').pop();

export default function Review({ reviewId }) {
  const { data, error, reload } = useLoad(`/reviews/${reviewId}`);
  const [active, setActive] = useState(null);
  const [saving, setSaving] = useState(new Set());
  const [failed, setFailed] = useState(new Set());
  const [busy, setBusy] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  if (!data) return <Loading error={error} retry={reload} />;
  const { review, analysis, suggestions } = data;
  if (review.status === 'completed') return (
    <div className="card notice">This review is completed. <a href={`#/reviews/${reviewId}/report`}>Open the final report</a>.</div>
  );

  const pending = suggestions.filter(s => s.status === 'pending').length;
  const resolved = suggestions.length - pending;
  const hasDecisions = suggestions.some(s => s.decision);
  const failedPending = suggestions.filter(s => s.status === 'pending' && failed.has(s.id)).length;

  const analyze = async () => {
    setBusy('analyze'); setPageError(null);
    try { await api(`/reviews/${reviewId}/analyze`, { method: 'POST' }); } catch (e) { setPageError(e.message); }
    await reload(); setBusy(null);
  };

  const decide = async (s, body) => {
    setSaving(p => new Set(p).add(s.id));
    try {
      await api(`/suggestions/${s.id}/decide`, { method: 'POST', body });
      setFailed(p => { const n = new Set(p); n.delete(s.id); return n; });
      await reload();
    } catch (e) {
      setFailed(p => new Set(p).add(s.id));
      if (e.status === 409) await reload();
      throw e;
    } finally {
      setSaving(p => { const n = new Set(p); n.delete(s.id); return n; });
    }
  };

  const complete = async () => {
    setBusy('complete'); setPageError(null);
    try { await api(`/reviews/${reviewId}/complete`, { method: 'POST' }); go(`/reviews/${reviewId}/report`); }
    catch (e) { setPageError(e.message); setBusy(null); reload(); }
  };

  const blockers = [
    !analysis && 'analyze the transcript',
    analysis && !review.summary_confirmed && 'confirm the summary',
    pending > 0 && `resolve ${pending} suggestion${pending > 1 ? 's' : ''}`,
    saving.size > 0 && 'wait for saves to finish',
    failedPending > 0 && 'fix the failed save',
  ].filter(Boolean);

  return (
    <>
      <a href={`#/cases/${review.case_id}`} className="back">‹ {data.case.title}</a>
      <header className="page-head">
        <div>
          <h1 className="display">{review.title}</h1>
          <p className="muted">
            <StatusPill status={review.status}>{STATUS_LABEL[review.status]}</StatusPill>{' '}
            {review.meeting_date || 'No meeting date'} · {data.transcript?.filename || 'Pasted text'} · reviewer {review.reviewer}
          </p>
        </div>
        {analysis && (
          <div className="complete-box">
            <div className="progress" aria-label={`${resolved} of ${suggestions.length} resolved`}>
              <motion.span className="progress-fill" animate={{ scaleX: suggestions.length ? resolved / suggestions.length : 1 }} transition={SPRING} />
            </div>
            <p className="small"><strong>{resolved} of {suggestions.length} resolved</strong>{review.summary_confirmed ? ' · summary confirmed' : ''}</p>
            <button className="btn primary" disabled={blockers.length > 0 || busy === 'complete'} onClick={complete}>
              {busy === 'complete' ? 'Completing…' : 'Complete review'}
            </button>
            {blockers.length > 0 && <p className="small muted">To complete: {blockers.join(', ')}.</p>}
          </div>
        )}
      </header>

      {pageError && <div className="notice error" role="alert">{pageError}</div>}

      {!analysis ? (
        <AnalysisState review={review} busy={busy === 'analyze'} onAnalyze={analyze} onRefresh={reload} />
      ) : (
        <div className="review-grid">
          <div className="col">
            <SummaryCard review={review} original={analysis.output.summary} onSaved={reload} />
            <ListCard title="Meeting decisions" note="Explicit decisions stated in the meeting." items={analysis.output.decisions} onOpen={setActive} empty="No explicit decisions were recorded." />
            <ListCard title="Open questions" items={analysis.output.questions} onOpen={setActive} empty="No open questions." />
            <ListCard title="Follow-up items" items={analysis.output.follow_ups} onOpen={setActive} empty="No follow-ups."
              extra={f => <span className="small muted"> — Owner: {f.owner || 'unspecified'} · Due: {f.due || 'unspecified'}</span>} />
            <div className="card stack">
              <p className="small muted">Analysis {analysis.id} · {analysis.model} · {(analysis.duration_ms / 1000).toFixed(1)}s</p>
              <div className="row">
                <button className="btn small" onClick={() => setAddOpen(true)}>Add a record from this meeting</button>
                {!hasDecisions && <button className="btn small" onClick={analyze} disabled={busy === 'analyze'}>{busy === 'analyze' ? 'Re-analyzing…' : 'Re-run analysis'}</button>}
              </div>
            </div>
          </div>

          <div className="col">
            <h2 className="col-title">Suggested record changes <span className="muted small">AI recommendations — not meeting decisions</span></h2>
            {analysis.discarded > 0 && (
              <div className="notice warn" role="status">{analysis.discarded} AI suggestion{analysis.discarded > 1 ? 's were' : ' was'} discarded because {analysis.discarded > 1 ? 'they' : 'it'} cited no valid transcript passage.</div>
            )}
            {!suggestions.length && (
              <div className="card notice">No record changes were proposed for this meeting. Confirm the summary, then complete the review.</div>
            )}
            <motion.div layout className="stack">
              {suggestions.map(s => (
                <SuggestionCard key={s.id} s={s} records={data.records} paragraphs={review.paragraphs} onOpen={setActive}
                  saving={saving.has(s.id)} onDecide={body => decide(s, body)} />
              ))}
            </motion.div>
          </div>

          <Evidence paragraphs={review.paragraphs} active={active} />
        </div>
      )}

      <ManualAddSheet open={addOpen} review={review} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); reload(); }} />
    </>
  );
}

function AnalysisState({ review, busy, onAnalyze, onRefresh }) {
  return (
    <div className="two-col">
      <div className="card stack">
        {review.status === 'failed' && (
          <div className="notice error" role="alert">
            <strong>Analysis failed.</strong> {review.error}
            <p className="small">No records were changed. Fix the problem and retry — earlier decisions are never overwritten.</p>
          </div>
        )}
        {review.status === 'analyzing' ? (
          <>
            <p aria-live="polite">Analysis is running…</p>
            <button className="btn" onClick={onRefresh}>Refresh</button>
          </>
        ) : (
          <button className="btn primary" onClick={onAnalyze} disabled={busy}>
            {busy ? 'Analyzing…' : review.status === 'failed' ? 'Retry analysis' : 'Analyze transcript'}
          </button>
        )}
      </div>
      <div className="card preview">
        <h2>Transcript</h2>
        <ol className="paragraphs">{review.paragraphs.map(p => <li key={p.id}><span className="pid">{p.id}</span><p>{p.text}</p></li>)}</ol>
      </div>
    </div>
  );
}

function SummaryCard({ review, original, onSaved }) {
  const [draft, setDraft] = useState(review.reviewed_summary ?? '');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== (review.reviewed_summary ?? '').trim();
  const save = async confirmed => {
    setSaving(true); setErr(null);
    try { await api(`/reviews/${review.id}/summary`, { method: 'PUT', body: { text: draft, confirmed } }); await onSaved(); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  return (
    <section className="card stack">
      <div className="section-head">
        <h2>Meeting summary</h2>
        {review.summary_confirmed && !dirty ? <span className="pill status-completed">Confirmed</span> : <span className="pill">Draft</span>}
      </div>
      <textarea rows={6} value={draft} onChange={e => setDraft(e.target.value)} aria-label="Reviewed meeting summary" />
      {draft.trim() !== original.trim() && <details className="small"><summary>Original AI summary</summary><p>{original}</p></details>}
      {err && <p className="error-text" role="alert">{err}</p>}
      <div className="row">
        {dirty && <button className="btn small" onClick={() => save(false)} disabled={saving || !draft.trim()}>Save edits</button>}
        {(!review.summary_confirmed || dirty) && <button className="btn primary small" onClick={() => save(true)} disabled={saving || !draft.trim()}>{saving ? 'Saving…' : 'Confirm summary'}</button>}
      </div>
    </section>
  );
}

function ListCard({ title, note, items, onOpen, empty, extra }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {note && <p className="small muted">{note}</p>}
      {items.length ? (
        <ul className="bullets">
          {items.map((it, i) => <li key={i}>{it.text}{extra?.(it)} <Refs refs={it.refs} onOpen={onOpen} /></li>)}
        </ul>
      ) : <p className="muted small">{empty}</p>}
    </section>
  );
}

function Evidence({ paragraphs, active }) {
  const box = useRef(null);
  useEffect(() => {
    if (!active) return;
    const el = box.current?.querySelector(`[data-pid="${active}"]`);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [active]);
  return (
    <aside className="card evidence" ref={box} aria-label="Transcript evidence">
      <h2>Transcript</h2>
      <ol className="paragraphs">
        {paragraphs.map(p => (
          <li key={p.id} data-pid={p.id} className={active === p.id ? 'hit' : ''}>
            <span className="pid">{p.id}</span><p>{p.text}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function SuggestionCard({ s, records, paragraphs, onOpen, saving, onDecide }) {
  const allowed = OUTCOMES[s.action];
  const [outcome, setOutcome] = useState(s.action === 'needs_review' ? null : s.action);
  const [target, setTarget] = useState(s.target_record_id ?? '');
  const [title, setTitle] = useState(s.title ?? '');
  const [content, setContent] = useState(s.proposed_content ?? s.record?.content ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const active = records.filter(r => r.status === 'active');
  const targetRec = records.find(r => r.id === target) ?? s.record;
  const needsTarget = outcome === 'update' || outcome === 'archive';
  const overriding = outcome && outcome !== s.action;
  const quote = paragraphs.find(p => p.id === s.refs[0])?.text ?? '';

  const submit = async () => {
    setErr(null);
    if (!outcome) return setErr('Choose an outcome.');
    if (needsTarget && !targetRec) return setErr('Choose a target record.');
    if ((outcome === 'add' || outcome === 'update') && !content.trim()) return setErr('Content is required.');
    if (overriding && !reason.trim()) return setErr('Explain why you are changing or rejecting this suggestion.');
    try {
      await onDecide({
        outcome, reason, title, content,
        target_record_id: needsTarget ? targetRec.id : undefined,
        expected_version: needsTarget ? targetRec.version : undefined,
      });
      setConfirmArchive(false);
    } catch (e) { setErr(e.message); setConfirmArchive(false); }
  };

  if (s.status === 'resolved') {
    const d = s.decision;
    return (
      <motion.article layout className="card suggestion resolved" transition={SPRING}>
        <div className="sug-head">
          <span className="sid">{shortId(s.id)}</span>
          <span className={`badge a-${s.action}`}>{ACTION_LABEL[s.action]}</span>
          <strong className="grow">{s.title}</strong>
          <span className="pill status-completed">Resolved · {ACTION_LABEL[d.chosen_action]}</span>
        </div>
        <p className="small muted">{d.reason} — {d.actor}, {fmtDate(d.created_at)}{d.resulting_version ? ` · ${d.target_record_id} v${d.resulting_version}` : ''}</p>
      </motion.article>
    );
  }

  return (
    <motion.article layout className="card suggestion" transition={SPRING}>
      <div className="sug-head">
        <span className="sid">{shortId(s.id)}</span>
        <span className={`badge a-${s.action}`}>{ACTION_LABEL[s.action]}</span>
        <strong className="grow">{s.title}</strong>
        <span className="pill">Pending</span>
      </div>
      {s.target_record_id && <p className="small muted">Target: <code>{s.target_record_id}</code> {s.record?.title} · v{s.record?.version}</p>}
      <p>{s.reason}</p>
      <blockquote className="quote">
        <p>“{quote.length > 280 ? `${quote.slice(0, 280)}…` : quote}”</p>
        <Refs refs={s.refs} onOpen={onOpen} />
      </blockquote>

      {(s.record || s.proposed_content) && (
        <div className="compare">
          <div><h4>Current</h4><p>{s.record?.content ?? <span className="muted">No matching record</span>}</p></div>
          <div><h4>Proposed</h4><p>{s.proposed_content ?? <span className="muted">No content change</span>}</p></div>
        </div>
      )}

      <div className="stack decide">
        <Segmented label={`Outcome for ${s.id}`} value={outcome} onChange={o => { setOutcome(o); setErr(null); }}
          options={allowed.map(o => [o, ACTION_LABEL[o]])} />

        <AnimatePresence initial={false}>
          {outcome && (
            <motion.div key="fields" className="stack" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={SPRING}>
              {s.action === 'needs_review' && needsTarget && (
                <label className="field"><span>Target record</span>
                  <select value={target} onChange={e => { setTarget(e.target.value); const r = records.find(x => x.id === e.target.value); if (outcome === 'update' && r && !s.proposed_content) setContent(r.content); }}>
                    <option value="">Choose…</option>
                    {active.map(r => <option key={r.id} value={r.id}>{r.id} — {r.title}</option>)}
                  </select>
                </label>
              )}
              {outcome === 'add' && (
                <label className="field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} /></label>
              )}
              {(outcome === 'add' || outcome === 'update') && (
                <label className="field"><span>{outcome === 'add' ? 'Content' : 'Approved content (saved as a new version)'}</span>
                  <textarea rows={5} value={content} onChange={e => setContent(e.target.value)} />
                </label>
              )}
              <label className="field"><span>Reviewer reason {overriding ? '(required)' : '(optional — AI reason is used if blank)'}</span>
                <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
              </label>
            </motion.div>
          )}
        </AnimatePresence>

        {err && <p className="error-text" role="alert">{err}</p>}
        <div className="row">
          <button className="btn primary" disabled={!outcome || saving}
            onClick={() => (outcome === 'archive' ? setConfirmArchive(true) : submit())}>
            {saving ? 'Saving…' : `Confirm ${outcome ? ACTION_LABEL[outcome].toLowerCase() : ''}`}
          </button>
        </div>
      </div>

      <Sheet open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive record?"
        footer={<>
          <button className="btn" onClick={() => setConfirmArchive(false)}>Cancel</button>
          <button className="btn danger" onClick={submit} disabled={saving}>{saving ? 'Archiving…' : 'Archive'}</button>
        </>}>
        <p><strong>{targetRec?.title}</strong> (<code>{targetRec?.id}</code>) moves to the Archived view. Its content and version history are kept.</p>
      </Sheet>
    </motion.article>
  );
}

function ManualAddSheet({ open, review, onClose, onDone }) {
  const [f, setF] = useState({ title: '', content: '', reason: '' });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setErr(null);
    try { await api(`/cases/${review.case_id}/records`, { method: 'POST', body: { ...f, review_id: review.id } }); setF({ title: '', content: '', reason: '' }); onDone(); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add a record from this meeting"
      footer={<button className="btn primary" onClick={submit} disabled={saving || !f.title.trim() || !f.content.trim()}>{saving ? 'Saving…' : 'Add record'}</button>}>
      <div className="stack">
        <p className="small muted">The new record is linked to this review and appears in its audit trail.</p>
        <label className="field"><span>Title</span><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Content</span><textarea rows={5} value={f.content} onChange={e => setF({ ...f, content: e.target.value })} /></label>
        <label className="field"><span>Reason</span><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></label>
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}
