import { useMemo, useState } from 'react';
import { api, go, splitParagraphs } from '../api.js';
import { useLoad, Loading } from '../ui.jsx';

const MAX_FILE_BYTES = 1_000_000;

export default function NewReview({ caseId, config }) {
  const { data: c, error, reload } = useLoad(`/cases/${caseId}`);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState(null);
  const [problem, setProblem] = useState(null);
  const [phase, setPhase] = useState('idle');
  const limit = config?.max_transcript_chars ?? 200_000;
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  const tooLong = text.length > limit;

  const readFile = async file => {
    setProblem(null);
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') return setProblem('Only .txt files are supported. Paste other formats as text.');
    if (file.size > MAX_FILE_BYTES) return setProblem('File is larger than 1 MB.');
    setText(await file.text());
    setFilename(file.name);
    if (!title) setTitle(file.name.replace(/\.txt$/i, ''));
  };

  const useDemo = async () => {
    const res = await fetch('/api/demo-transcript');
    setText(await res.text());
    setFilename('demo-transcript.txt');
    setTitle(t => t || 'Elmere data protection precedent review');
    setDate(d => d || '2026-10-08');
  };

  const start = async e => {
    e.preventDefault();
    setProblem(null);
    if (!text.trim()) return setProblem('Transcript is empty. Upload a .txt file or paste the transcript text.');
    setPhase('uploading');
    let review;
    try {
      review = await api(`/cases/${caseId}/reviews`, { method: 'POST', body: { title, meeting_date: date, text, filename } });
    } catch (x) { setPhase('idle'); return setProblem(x.message); }
    setPhase('analyzing');
    // A failed analysis is shown with a retry on the review page.
    await api(`/reviews/${review.id}/analyze`, { method: 'POST' }).catch(() => {});
    go(`/reviews/${review.id}`);
  };

  if (!c) return <Loading error={error} retry={reload} />;
  const busy = phase !== 'idle';

  return (
    <>
      <a href={`#/cases/${caseId}`} className="back">‹ {c.title}</a>
      <header className="page-head">
        <div>
          <h1 className="display">New meeting review</h1>
          <p className="muted">Upload a transcript. RippleWise drafts a summary and suggests record changes. Nothing changes until you confirm it.</p>
        </div>
      </header>

      {config && !config.ai_configured && (
        <div className="notice warn" role="status">
          <strong>AWS Bedrock key not configured.</strong> Analysis will fail until <code>BEDROCK_API_KEY</code> is set in <code>.env</code> and the server is restarted. You can still upload and retry later.
        </div>
      )}

      <form className="two-col" onSubmit={start}>
        <div className="card stack">
          <label className="field"><span>Meeting title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} required disabled={busy} />
          </label>
          <label className="field"><span>Meeting date (optional)</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={busy} />
          </label>
          <label className="field"><span>Transcript file (.txt, up to 1 MB)</span>
            <input type="file" accept=".txt,text/plain" onChange={e => readFile(e.target.files[0])} disabled={busy} />
          </label>
          <label className="field"><span>…or paste the transcript</span>
            <textarea rows={10} value={text} onChange={e => { setText(e.target.value); setFilename(null); }} disabled={busy}
              placeholder="Separate paragraphs with a blank line." />
          </label>
          <p className={`small ${tooLong ? 'error-text' : 'muted'}`}>{text.length.toLocaleString()} / {limit.toLocaleString()} characters · {paragraphs.length} paragraphs</p>
          {problem && <p className="error-text" role="alert">{problem}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={useDemo} disabled={busy}>Use demo transcript</button>
            <button className="btn primary" disabled={busy || !title.trim() || !text.trim() || tooLong}>
              {phase === 'uploading' ? 'Uploading…' : phase === 'analyzing' ? 'Analyzing…' : 'Upload & analyze'}
            </button>
          </div>
          {phase === 'analyzing' && <p className="muted small" aria-live="polite">Comparing the transcript with {c.records.filter(r => r.status === 'active').length} active records…</p>}
        </div>

        <div className="card preview">
          <h2>Preview</h2>
          {paragraphs.length ? (
            <ol className="paragraphs">
              {paragraphs.map(p => <li key={p.id}><span className="pid">{p.id}</span><p>{p.text}</p></li>)}
            </ol>
          ) : <p className="muted">The extracted paragraphs appear here, each with the ID used in evidence links.</p>}
        </div>
      </form>
    </>
  );
}
