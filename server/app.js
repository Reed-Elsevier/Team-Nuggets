import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tx, audit, now, insertRecord } from './db.js';
import { validateOutput } from './analyze.js';
import { parseCsv } from './csv.js';

export const MAX_TRANSCRIPT_CHARS = 200_000;
const OUTCOMES = {
  archive: ['archive', 'retain'],
  update: ['update', 'retain'],
  add: ['add', 'dismiss'],
  needs_review: ['add', 'update', 'archive', 'no_change'],
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const newId = prefix => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const text = v => (typeof v === 'string' ? v.trim() : '');

export function splitParagraphs(raw) {
  let blocks = raw.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean);
  if (blocks.length === 1) blocks = blocks[0].split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return blocks.map((t, i) => ({ id: `P${i + 1}`, text: t }));
}

export function createApp({ db, analyzer }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const q = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const actorOf = req => {
    let name = text(req.get('x-reviewer'));
    try { name = decodeURIComponent(name).trim(); } catch { /* keep raw header */ }
    return name || fail(400, 'Reviewer name required (demo mode: enter your name).');
  };

  const getCase = id => one('SELECT * FROM cases WHERE id = ?', id) ?? fail(404, 'Case not found.');
  const getReview = id => {
    const r = one('SELECT * FROM reviews WHERE id = ?', id) ?? fail(404, 'Review not found.');
    return { ...r, paragraphs: JSON.parse(r.paragraphs), summary_confirmed: Boolean(r.summary_confirmed) };
  };
  const openReview = (id, caseId) => {
    const r = getReview(id);
    if (caseId && r.case_id !== caseId) fail(400, 'Review belongs to a different case.');
    if (r.status === 'completed') fail(409, 'Review is completed and can no longer change.');
    return r;
  };
  const getRecord = (caseId, id) => one(`SELECT r.*, v.content FROM records r
    JOIN record_versions v ON v.case_id = r.case_id AND v.record_id = r.id AND v.version = r.version
    WHERE r.case_id = ? AND r.id = ?`, caseId, id);
  const caseRecords = caseId => q(`SELECT r.*, v.content FROM records r
    JOIN record_versions v ON v.case_id = r.case_id AND v.record_id = r.id AND v.version = r.version
    WHERE r.case_id = ? ORDER BY r.status, r.type, r.id`, caseId);
  const checkVersion = (rec, expected) => {
    if (!rec) fail(404, 'Target record not found in this case.');
    if (rec.status !== 'active') fail(409, `Record ${rec.id} is archived.`);
    if (Number(expected) !== rec.version) fail(409, `Record ${rec.id} changed since you loaded it (now version ${rec.version}). Reload and review again.`, { current_version: rec.version });
  };
  const nextRecordId = caseId => {
    for (;;) { const id = newId('R'); if (!one('SELECT 1 FROM records WHERE case_id = ? AND id = ?', caseId, id)) return id; }
  };
  const writeVersion = (caseId, rec, { title, content }, actor, reviewId) => {
    const version = rec.version + 1;
    db.prepare('INSERT INTO record_versions (case_id, record_id, version, title, content, source_ref, created_at, actor, review_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(caseId, rec.id, version, title || rec.title, content, rec.source_ref, now(), actor, reviewId ?? null);
    db.prepare('UPDATE records SET version = ?, title = ? WHERE case_id = ? AND id = ?').run(version, title || rec.title, caseId, rec.id);
    return version;
  };

  app.get('/api/config', (req, res) => res.json({ ai_configured: analyzer.configured, model: analyzer.model, max_transcript_chars: MAX_TRANSCRIPT_CHARS }));
  app.get('/api/demo-transcript', (req, res) => res.type('text/plain').send(readFileSync(new URL('./seed/demo-transcript.txt', import.meta.url), 'utf8')));

  // Cases
  app.get('/api/cases', (req, res) => res.json(q(`SELECT c.*,
    (SELECT COUNT(*) FROM records r WHERE r.case_id = c.id AND r.status = 'active') AS active_records,
    (SELECT COUNT(*) FROM records r WHERE r.case_id = c.id AND r.status = 'archived') AS archived_records,
    (SELECT COUNT(*) FROM reviews v WHERE v.case_id = c.id) AS reviews
    FROM cases c ORDER BY c.created_at`)));

  app.post('/api/cases', (req, res) => {
    const actor = actorOf(req);
    const title = text(req.body.title) || fail(400, 'Case title is required.');
    const id = newId('CASE');
    tx(db, () => {
      db.prepare('INSERT INTO cases (id, title, description, created_at) VALUES (?,?,?,?)').run(id, title, text(req.body.description), now());
      audit(db, { case_id: id, actor, action: 'case.created', target: id, outcome: title });
    });
    res.status(201).json(getCase(id));
  });

  app.get('/api/cases/:id', (req, res) => {
    const c = getCase(req.params.id);
    res.json({ ...c, records: caseRecords(c.id), reviews: q('SELECT id, title, meeting_date, status, reviewer, created_at, completed_at FROM reviews WHERE case_id = ? ORDER BY created_at DESC', c.id) });
  });

  app.get('/api/cases/:id/records/:rid/versions', (req, res) => {
    const c = getCase(req.params.id);
    const rec = getRecord(c.id, req.params.rid) ?? fail(404, 'Record not found.');
    res.json({ record: rec, versions: q('SELECT * FROM record_versions WHERE case_id = ? AND record_id = ? ORDER BY version DESC', c.id, rec.id) });
  });

  app.post('/api/cases/:id/records', (req, res) => {
    const actor = actorOf(req);
    const c = getCase(req.params.id);
    const reviewId = req.body.review_id || null;
    if (reviewId) openReview(reviewId, c.id);
    const r = {
      id: text(req.body.id) || nextRecordId(c.id),
      title: text(req.body.title) || fail(400, 'Title is required.'),
      content: text(req.body.content) || fail(400, 'Content is required.'),
      type: text(req.body.type) || null,
      source_ref: text(req.body.source_ref) || (reviewId ? `Review ${reviewId}` : 'Manual entry'),
    };
    if (getRecord(c.id, r.id)) fail(409, `Record ID ${r.id} already exists in this case.`);
    tx(db, () => {
      insertRecord(db, c.id, r, actor, reviewId);
      audit(db, { case_id: c.id, review_id: reviewId, actor, action: 'record.manual_add', target: r.id, after_version: 1, outcome: 'added', detail: { reason: text(req.body.reason) || null, title: r.title, content: r.content } });
    });
    res.status(201).json(getRecord(c.id, r.id));
  });

  app.put('/api/cases/:id/records/:rid', (req, res) => {
    const actor = actorOf(req);
    const c = getCase(req.params.id);
    const reviewId = req.body.review_id || null;
    if (reviewId) openReview(reviewId, c.id);
    const content = text(req.body.content) || fail(400, 'Content is required.');
    const version = tx(db, () => {
      const rec = getRecord(c.id, req.params.rid);
      checkVersion(rec, req.body.expected_version);
      const v = writeVersion(c.id, rec, { title: text(req.body.title), content }, actor, reviewId);
      audit(db, { case_id: c.id, review_id: reviewId, actor, action: 'record.manual_update', target: rec.id, before_version: rec.version, after_version: v, outcome: 'updated', detail: { reason: text(req.body.reason) || null, before: rec.content, after: content } });
      return v;
    });
    res.json({ ...getRecord(c.id, req.params.rid), version });
  });

  app.post('/api/cases/:id/import', (req, res) => {
    const actor = actorOf(req);
    const c = getCase(req.params.id);
    const rows = parseCsv(String(req.body.csv ?? '').replace(/^\uFEFF/, ''));
    if (rows.length < 2) fail(400, 'CSV needs a header row and at least one record.', { errors: [] });
    const header = rows[0].map(h => h.trim().toLowerCase());
    const missing = ['id', 'title', 'content', 'source_ref'].filter(h => !header.includes(h));
    if (missing.length) fail(400, `CSV header is missing: ${missing.join(', ')}.`, { errors: [] });
    const col = name => header.indexOf(name);
    const seen = new Set(), errors = [], records = [];
    rows.slice(1).forEach((row, i) => {
      const line = i + 2;
      const r = { id: row[col('id')]?.trim(), title: row[col('title')]?.trim(), content: row[col('content')]?.trim(), source_ref: row[col('source_ref')]?.trim(), type: col('type') >= 0 ? row[col('type')]?.trim() || null : null };
      const problems = ['id', 'title', 'content', 'source_ref'].filter(k => !r[k]).map(k => `${k} is empty`);
      if (r.id && (seen.has(r.id) || getRecord(c.id, r.id))) problems.push(`ID ${r.id} already exists`);
      if (problems.length) errors.push({ line, message: problems.join('; ') });
      seen.add(r.id);
      records.push(r);
    });
    if (errors.length) fail(400, `${errors.length} row(s) have errors. Nothing was imported.`, { errors });
    tx(db, () => {
      for (const r of records) insertRecord(db, c.id, r, actor);
      audit(db, { case_id: c.id, actor, action: 'records.imported', outcome: `${records.length} records`, detail: { ids: records.map(r => r.id) } });
    });
    res.status(201).json({ imported: records.length });
  });

  // Reviews
  app.post('/api/cases/:id/reviews', (req, res) => {
    const actor = actorOf(req);
    const c = getCase(req.params.id);
    const title = text(req.body.title) || fail(400, 'Meeting title is required.');
    const raw = typeof req.body.text === 'string' ? req.body.text : '';
    if (!raw.trim()) fail(400, 'Transcript is empty. Upload a .txt file or paste the transcript text.');
    if (raw.length > MAX_TRANSCRIPT_CHARS) fail(400, `Transcript is too long (${raw.length.toLocaleString()} characters). The limit is ${MAX_TRANSCRIPT_CHARS.toLocaleString()}.`);
    const id = newId('RV'), tid = newId('TR'), ts = now();
    const paragraphs = splitParagraphs(raw);
    tx(db, () => {
      db.prepare('INSERT INTO transcripts (id, case_id, filename, original_text, created_at) VALUES (?,?,?,?,?)').run(tid, c.id, text(req.body.filename) || null, raw, ts);
      db.prepare(`INSERT INTO reviews (id, case_id, title, meeting_date, transcript_id, paragraphs, status, reviewer, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, c.id, title, text(req.body.meeting_date) || null, tid, JSON.stringify(paragraphs), 'uploaded', actor, ts, ts);
      audit(db, { case_id: c.id, review_id: id, actor, action: 'review.created', target: tid, outcome: `${paragraphs.length} paragraphs` });
    });
    res.status(201).json(getReview(id));
  });

  app.post('/api/reviews/:id/analyze', async (req, res) => {
    const actor = actorOf(req);
    const review = openReview(req.params.id);
    if (review.status === 'analyzing') fail(409, 'Analysis is already running.');
    if (one('SELECT COUNT(*) n FROM decisions WHERE review_id = ?', review.id).n > 0) fail(409, 'Review already has decisions; re-analysis would discard reviewed work.');
    const c = getCase(review.case_id);
    const records = caseRecords(c.id).filter(r => r.status === 'active');
    db.prepare("UPDATE reviews SET status = 'analyzing', error = NULL, updated_at = ? WHERE id = ?").run(now(), review.id);
    const started = Date.now(), analysisId = newId('AN');
    const snapshot = JSON.stringify(records.map(r => ({ id: r.id, version: r.version })));
    try {
      const raw = await analyzer.analyze({ paragraphs: review.paragraphs, records: records.map(({ case_id, ...r }) => r), caseTitle: c.title });
      const { output, suggestions, discarded } = validateOutput(raw, review.paragraphs, records);
      tx(db, () => {
        db.prepare('INSERT INTO analyses (id, review_id, model, record_versions, output, discarded, created_at, duration_ms) VALUES (?,?,?,?,?,?,?,?)')
          .run(analysisId, review.id, analyzer.model, snapshot, JSON.stringify(output), discarded, now(), Date.now() - started);
        db.prepare("UPDATE suggestions SET status = 'superseded' WHERE review_id = ? AND status = 'pending'").run(review.id);
        const base = one('SELECT COUNT(*) n FROM suggestions WHERE review_id = ?', review.id).n;
        const ins = db.prepare(`INSERT INTO suggestions (id, analysis_id, review_id, action, target_record_id, target_version, title, reason, refs, proposed_content)
          VALUES (?,?,?,?,?,?,?,?,?,?)`);
        suggestions.forEach((s, i) => ins.run(`${review.id}-S${base + i + 1}`, analysisId, review.id, s.action, s.target_record_id, s.target_version, s.title, s.reason, JSON.stringify(s.refs), s.proposed_content));
        db.prepare("UPDATE reviews SET status = 'awaiting_review', reviewed_summary = ?, summary_confirmed = 0, updated_at = ? WHERE id = ?").run(output.summary, now(), review.id);
        audit(db, { case_id: c.id, review_id: review.id, actor, action: 'analysis.completed', target: analysisId, outcome: `${suggestions.length} suggestions, ${discarded} discarded`, detail: { model: analyzer.model, duration_ms: Date.now() - started } });
      });
      res.json(getReview(review.id));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      tx(db, () => {
        db.prepare('INSERT INTO analyses (id, review_id, model, record_versions, error, created_at, duration_ms) VALUES (?,?,?,?,?,?,?)')
          .run(analysisId, review.id, analyzer.model, snapshot, e.message, now(), Date.now() - started);
        db.prepare("UPDATE reviews SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(e.message, now(), review.id);
        audit(db, { case_id: c.id, review_id: review.id, actor, action: 'analysis.failed', target: analysisId, outcome: e.message });
      });
      res.status(502).json({ error: e.message, review: getReview(review.id) });
    }
  });

  const suggestionsOf = reviewId => q("SELECT * FROM suggestions WHERE review_id = ? AND status != 'superseded' ORDER BY rowid", reviewId).map(s => ({
    ...s, refs: JSON.parse(s.refs),
    decision: one('SELECT * FROM decisions WHERE suggestion_id = ?', s.id) ?? null,
  }));
  const latestAnalysis = reviewId => {
    const a = one('SELECT * FROM analyses WHERE review_id = ? AND output IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1', reviewId);
    return a ? { ...a, output: JSON.parse(a.output), record_versions: JSON.parse(a.record_versions) } : null;
  };

  app.get('/api/reviews/:id', (req, res) => {
    const review = getReview(req.params.id);
    const c = getCase(review.case_id);
    const transcript = one('SELECT id, filename, created_at FROM transcripts WHERE id = ?', review.transcript_id);
    const suggestions = suggestionsOf(review.id).map(s => ({
      ...s,
      record: s.target_record_id ? getRecord(c.id, s.target_record_id) ?? null : null,
      result_record: s.decision?.target_record_id ? getRecord(c.id, s.decision.target_record_id) ?? null : null,
    }));
    res.json({ case: c, review, transcript, analysis: latestAnalysis(review.id), suggestions, records: caseRecords(c.id) });
  });

  app.put('/api/reviews/:id/summary', (req, res) => {
    const actor = actorOf(req);
    const review = openReview(req.params.id);
    if (!latestAnalysis(review.id)) fail(409, 'Analyze the transcript before editing the summary.');
    const summary = text(req.body.text) || fail(400, 'Summary cannot be empty.');
    const confirmed = req.body.confirmed === true;
    tx(db, () => {
      db.prepare('UPDATE reviews SET reviewed_summary = ?, summary_confirmed = ?, updated_at = ? WHERE id = ?').run(summary, confirmed ? 1 : 0, now(), review.id);
      audit(db, { case_id: review.case_id, review_id: review.id, actor, action: confirmed ? 'summary.confirmed' : 'summary.edited', detail: { text: summary } });
    });
    res.json(getReview(review.id));
  });

  app.post('/api/suggestions/:id/decide', (req, res) => {
    const actor = actorOf(req);
    const s = one('SELECT * FROM suggestions WHERE id = ?', req.params.id) ?? fail(404, 'Suggestion not found.');
    const review = openReview(s.review_id);
    const caseId = review.case_id;
    const outcome = req.body.outcome;
    if (!OUTCOMES[s.action]?.includes(outcome)) fail(400, `"${outcome}" is not a valid outcome for a ${s.action} suggestion. Choose: ${OUTCOMES[s.action].join(', ')}.`);
    const reason = text(req.body.reason) || (outcome === s.action ? s.reason : '') || fail(400, 'A reason is required when you change or reject the suggestion.');
    const targetId = s.action === 'needs_review' ? text(req.body.target_record_id) || s.target_record_id : s.target_record_id;

    const decision = tx(db, () => {
      // Re-read inside the transaction so a duplicate click sees the first write.
      if (one('SELECT status FROM suggestions WHERE id = ?', s.id).status !== 'pending') fail(409, 'This suggestion is already resolved.');
      let target = targetId, before = null, after = null, approved = null;
      if (outcome === 'update' || outcome === 'archive') {
        if (!targetId) fail(400, 'Choose a target record.');
        const rec = getRecord(caseId, targetId);
        checkVersion(rec, req.body.expected_version);
        before = rec.version;
        if (outcome === 'update') {
          approved = text(req.body.content) || fail(400, 'Updated content is required.');
          after = writeVersion(caseId, rec, { title: text(req.body.title), content: approved }, actor, review.id);
        } else {
          db.prepare("UPDATE records SET status = 'archived' WHERE case_id = ? AND id = ?").run(caseId, rec.id);
          after = rec.version;
        }
      } else if (outcome === 'add') {
        approved = text(req.body.content) || fail(400, 'Content is required to add a record.');
        target = nextRecordId(caseId);
        insertRecord(db, caseId, { id: target, title: text(req.body.title) || s.title, content: approved, type: text(req.body.type) || null, source_ref: `Review ${review.id} · ${JSON.parse(s.refs).join(', ')}` }, actor, review.id);
        after = 1;
      } else if (target) {
        before = after = getRecord(caseId, target)?.version ?? null;
      }
      const d = { suggestion_id: s.id, review_id: review.id, chosen_action: outcome, target_record_id: target ?? null, approved_content: approved, reason, actor, created_at: now(), resulting_version: after };
      db.prepare(`INSERT INTO decisions (suggestion_id, review_id, chosen_action, target_record_id, approved_content, reason, actor, created_at, resulting_version)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(...Object.values(d));
      db.prepare("UPDATE suggestions SET status = 'resolved' WHERE id = ?").run(s.id);
      db.prepare("UPDATE reviews SET status = 'in_review', updated_at = ? WHERE id = ?").run(now(), review.id);
      audit(db, {
        case_id: caseId, review_id: review.id, suggestion_id: s.id, actor, action: `suggestion.${outcome}`, target: target ?? null,
        before_version: before, after_version: after, outcome: outcome === s.action ? 'accepted' : 'overridden',
        detail: { suggested: { action: s.action, target_record_id: s.target_record_id, reason: s.reason, proposed_content: s.proposed_content, refs: JSON.parse(s.refs) }, reason, approved_content: approved },
      });
      return d;
    });
    res.json(decision);
  });

  app.post('/api/reviews/:id/complete', (req, res) => {
    const actor = actorOf(req);
    tx(db, () => {
      const review = openReview(req.params.id);
      if (!latestAnalysis(review.id)) fail(409, 'The transcript has not been analyzed.');
      if (!review.summary_confirmed) fail(409, 'Confirm the meeting summary first.');
      const pending = one("SELECT COUNT(*) n FROM suggestions WHERE review_id = ? AND status = 'pending'", review.id).n;
      if (pending) fail(409, `${pending} suggestion(s) are still unresolved.`);
      const ts = now();
      db.prepare("UPDATE reviews SET status = 'completed', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?").run(ts, actor, ts, review.id);
      audit(db, { case_id: review.case_id, review_id: review.id, actor, action: 'review.completed' });
    });
    res.json(getReview(req.params.id));
  });

  app.get('/api/reviews/:id/report', (req, res) => {
    const review = getReview(req.params.id);
    if (review.status !== 'completed') fail(409, 'The report is available once the review is completed.');
    const analysis = latestAnalysis(review.id);
    const suggestions = suggestionsOf(review.id);
    const audit = q('SELECT * FROM audit_events WHERE review_id = ? ORDER BY id', review.id).map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
    const recordAt = (id, version) => id ? one('SELECT record_id, version, title, content FROM record_versions WHERE case_id = ? AND record_id = ? AND version = ?', review.case_id, id, version) : null;
    const changes = { added: [], updated: [], archived: [], retained: [] };
    for (const e of audit) {
      if (e.action === 'suggestion.add' || e.action === 'record.manual_add') changes.added.push(recordAt(e.target, 1));
      else if (e.action === 'suggestion.update' || e.action === 'record.manual_update') changes.updated.push({ ...recordAt(e.target, e.after_version), previous_version: e.before_version });
      else if (e.action === 'suggestion.archive') changes.archived.push(recordAt(e.target, e.after_version));
      else if (e.action === 'suggestion.retain') changes.retained.push(recordAt(e.target, e.after_version));
    }
    const { paragraphs, ...meta } = review;
    res.json({
      case: getCase(review.case_id), review: meta, paragraphs, summary: review.reviewed_summary,
      decisions: analysis.output.decisions, questions: analysis.output.questions, follow_ups: analysis.output.follow_ups,
      original_summary: analysis.output.summary, analysis: { id: analysis.id, model: analysis.model, duration_ms: analysis.duration_ms, discarded: analysis.discarded },
      suggestions, changes, audit,
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error(err);
    res.status(500).json({ error: 'The change could not be saved. Nothing was modified — please try again.' });
  });
  return app;
}
