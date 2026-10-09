import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb, seedDemo } from '../server/db.js';
import { createApp } from '../server/app.js';
import { bedrockAnalyzer, validateOutput } from '../server/analyze.js';
import { parseCsv } from '../server/csv.js';

const CASE = 'CASE-ELM-DP';
const TEXT = 'Jill: the 2026 breach regulations are not in the set.\n\nMarco: the 2022 practice note needs the 72-hour duty.\n\nMarco: the 2021 commentary is superseded by 2024.\n\nJill: unsure whether Odom was overruled on lawfulness.';

const OUTPUT = {
  summary: 'Team reviewed the Elmere set.',
  decisions: [{ text: 'Add the 2026 regulations.', refs: ['P1'] }],
  questions: [{ text: 'Was Odom overruled on lawfulness?', refs: ['P4', 'P77'] }],
  follow_ups: [{ text: 'Verify Odom status.', owner: null, due: null, refs: ['P4'] }],
  suggestions: [
    { action: 'add', target_record_id: null, title: 'Breach Notification Regulations 2026', reason: 'New regulation.', refs: ['P1'], proposed_content: '72-hour notification.' },
    { action: 'update', target_record_id: 'LD00002457', title: 'Practice note 2022', reason: 'Missing 72-hour duty.', refs: ['P2'], proposed_content: 'Updated practice note.' },
    { action: 'archive', target_record_id: 'LD00002522', title: 'Commentary 2021', reason: 'Superseded.', refs: ['P3'], proposed_content: null },
    { action: 'needs_review', target_record_id: 'LD00006398', title: 'Odom', reason: 'Conflicting evidence.', refs: ['P4'], proposed_content: null },
    { action: 'update', target_record_id: 'NOPE', title: 'Ghost', reason: 'Bad target.', refs: ['P2'], proposed_content: 'x' },
    { action: 'archive', target_record_id: 'LD00003117', title: 'No evidence', reason: 'Bad ref.', refs: ['P99'], proposed_content: null },
  ],
};

const stub = (output = OUTPUT) => {
  const s = { model: 'stub', configured: true, calls: [], async analyze(input) { s.calls.push(input); return structuredClone(output); } };
  return s;
};

async function setup(t, analyzer = stub()) {
  const db = openDb();
  seedDemo(db);
  const server = createApp({ db, analyzer }).listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, reviewer = 'Test Reviewer') => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-reviewer': reviewer },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const snapshot = () => JSON.stringify([
    db.prepare('SELECT * FROM records ORDER BY case_id, id').all(),
    db.prepare('SELECT case_id, record_id, version, content FROM record_versions ORDER BY 1,2,3').all(),
  ]);
  return { db, call, snapshot, analyzer };
}

async function analyzed(ctx) {
  const r = await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'Precedent review', text: TEXT });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = await ctx.call('POST', `/reviews/${r.body.id}/analyze`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const review = (await ctx.call('GET', `/reviews/${r.body.id}`)).body;
  const by = title => review.suggestions.find(s => s.title === title);
  return { id: r.body.id, review, by };
}

test('missing Bedrock key fails analysis cleanly without touching records (AC01/AC07)', async t => {
  const ctx = await setup(t, bedrockAnalyzer({ apiKey: 'your-bedrock-api-key-here' }));
  const before = ctx.snapshot();
  const r = await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'M', text: TEXT });
  const a = await ctx.call('POST', `/reviews/${r.body.id}/analyze`);
  assert.equal(a.status, 502);
  assert.match(a.body.error, /Bedrock key not configured/);
  const review = (await ctx.call('GET', `/reviews/${r.body.id}`)).body;
  assert.equal(review.review.status, 'failed');
  assert.equal(review.suggestions.length, 0);
  assert.equal(ctx.snapshot(), before);
  assert.equal((await ctx.call('POST', `/reviews/${r.body.id}/analyze`)).status, 502, 'retry stays available');
  assert.equal((await ctx.call('GET', '/config')).body.ai_configured, false);
});

test('transcript intake validates empty, oversize and missing reviewer (AC07)', async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'M', text: '  \n\n ' })).status, 400);
  assert.equal((await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'M', text: 'x'.repeat(200_001) })).status, 400);
  assert.equal((await ctx.call('POST', `/cases/${CASE}/reviews`, { title: '', text: 'hi' })).status, 400);
  assert.equal((await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'M', text: 'hi' }, '')).status, 400);
  const ok = await ctx.call('POST', `/cases/${CASE}/reviews`, { title: 'M', text: TEXT, filename: 'm.txt' });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.paragraphs.map(p => p.id), ['P1', 'P2', 'P3', 'P4']);
});

test('analysis drafts validated suggestions and changes no records (AC01/AC10 refs)', async t => {
  const ctx = await setup(t);
  const before = ctx.snapshot();
  const { review, by } = await analyzed(ctx);
  assert.equal(review.review.status, 'awaiting_review');
  assert.equal(review.analysis.discarded, 1);
  assert.equal(review.suggestions.length, 5);
  assert.equal(by('Ghost').action, 'needs_review');
  assert.equal(by('Ghost').target_record_id, null);
  assert.deepEqual(review.analysis.output.questions[0].refs, ['P4']);
  const ids = new Set(review.review.paragraphs.map(p => p.id));
  for (const s of review.suggestions) for (const ref of s.refs) assert.ok(ids.has(ref));
  assert.equal(ctx.snapshot(), before);
  assert.ok(ctx.analyzer.calls[0].records.every(r => r.case_id === undefined || r.case_id === CASE));
});

test('retain on archive suggestion keeps record active and audits it (AC02)', async t => {
  const ctx = await setup(t);
  const { id, by } = await analyzed(ctx);
  const s = by('Commentary 2021');
  assert.equal((await ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'retain' })).status, 400, 'override needs a reason');
  const d = await ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'retain', reason: 'Subscribers still cite it.' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const rec = (await ctx.call('GET', `/cases/${CASE}`)).body.records.find(r => r.id === 'LD00002522');
  assert.equal(rec.status, 'active');
  const after = (await ctx.call('GET', `/reviews/${id}`)).body;
  assert.equal(after.suggestions.find(x => x.id === s.id).status, 'resolved');
  assert.equal(after.review.status, 'in_review');
  const ev = ctx.db.prepare("SELECT * FROM audit_events WHERE suggestion_id = ?").get(s.id);
  assert.equal(ev.action, 'suggestion.retain');
  assert.equal(ev.actor, 'Test Reviewer');
});

test('confirm archive moves record to archived with history kept (AC03)', async t => {
  const ctx = await setup(t);
  const { by } = await analyzed(ctx);
  const d = await ctx.call('POST', `/suggestions/${by('Commentary 2021').id}/decide`, { outcome: 'archive', expected_version: 1 });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const rec = (await ctx.call('GET', `/cases/${CASE}`)).body.records.find(r => r.id === 'LD00002522');
  assert.equal(rec.status, 'archived');
  assert.match(rec.content, /commentary/);
  const v = await ctx.call('GET', `/cases/${CASE}/records/LD00002522/versions`);
  assert.equal(v.body.versions.length, 1);
});

test('edited update creates a new version and keeps the prior one (AC04)', async t => {
  const ctx = await setup(t);
  const { by } = await analyzed(ctx);
  const d = await ctx.call('POST', `/suggestions/${by('Practice note 2022').id}/decide`, { outcome: 'update', content: 'Reviewer-edited note.', expected_version: 1 });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const v = (await ctx.call('GET', `/cases/${CASE}/records/LD00002457/versions`)).body.versions;
  assert.deepEqual(v.map(x => x.version), [2, 1]);
  assert.equal(v[0].content, 'Reviewer-edited note.');
  const ev = ctx.db.prepare("SELECT * FROM audit_events WHERE action = 'suggestion.update'").get();
  assert.equal(ev.before_version, 1);
  assert.equal(ev.after_version, 2);
  assert.equal(JSON.parse(ev.detail).approved_content, 'Reviewer-edited note.');
});

test('add creates exactly one record; duplicate click is rejected (AC05/AC07)', async t => {
  const ctx = await setup(t);
  const { by } = await analyzed(ctx);
  const s = by('Breach Notification Regulations 2026');
  const count = () => ctx.db.prepare('SELECT COUNT(*) n FROM records').get().n;
  const n = count();
  const [a, b] = await Promise.all([
    ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'add', title: s.title, content: s.proposed_content }),
    ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'add', title: s.title, content: s.proposed_content }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(count(), n + 1);
});

test('dismiss on add creates no record but records the decision (AC05)', async t => {
  const ctx = await setup(t);
  const { by } = await analyzed(ctx);
  const n = ctx.db.prepare('SELECT COUNT(*) n FROM records').get().n;
  const d = await ctx.call('POST', `/suggestions/${by('Breach Notification Regulations 2026').id}/decide`, { outcome: 'dismiss', reason: 'Wait for final text.' });
  assert.equal(d.status, 200);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM records').get().n, n);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 1);
});

test('stale version and failed save leave the suggestion pending (AC07)', async t => {
  const ctx = await setup(t);
  const { id, by } = await analyzed(ctx);
  const s = by('Practice note 2022');
  const stale = await ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'update', content: 'x', expected_version: 0 });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed/);

  ctx.db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const before = ctx.snapshot();
  const failed = await ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'update', content: 'x', expected_version: 1 });
  assert.equal(failed.status, 500);
  assert.equal(ctx.snapshot(), before);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 0);
  assert.equal((await ctx.call('GET', `/reviews/${id}`)).body.suggestions.find(x => x.id === s.id).status, 'pending');

  ctx.db.exec('DROP TRIGGER boom');
  assert.equal((await ctx.call('POST', `/suggestions/${s.id}/decide`, { outcome: 'update', content: 'x', expected_version: 1 })).status, 200);
});

test('retry supersedes pending suggestions only before any decision', async t => {
  const ctx = await setup(t);
  const { id, by } = await analyzed(ctx);
  assert.equal((await ctx.call('POST', `/reviews/${id}/analyze`)).status, 200);
  const r = (await ctx.call('GET', `/reviews/${id}`)).body;
  assert.equal(r.suggestions.length, 5);
  assert.ok(r.suggestions.every(s => s.id !== by('Ghost').id));
  await ctx.call('POST', `/suggestions/${r.suggestions[0].id}/decide`, { outcome: r.suggestions[0].action === 'add' ? 'dismiss' : 'retain', reason: 'n/a' });
  assert.equal((await ctx.call('POST', `/reviews/${id}/analyze`)).status, 409);
});

test('progress persists; completion gate; full report and audit (AC06/AC08)', async t => {
  const ctx = await setup(t);
  const { id, by } = await analyzed(ctx);
  const decide = (title, body) => ctx.call('POST', `/suggestions/${by(title).id}/decide`, body);
  assert.equal((await decide('Commentary 2021', { outcome: 'retain', reason: 'Still cited.' })).status, 200);

  const reloaded = (await ctx.call('GET', `/reviews/${id}`)).body;
  assert.equal(reloaded.suggestions.filter(s => s.status === 'resolved').length, 1);
  assert.equal(reloaded.suggestions.find(s => s.title === 'Commentary 2021').decision.reason, 'Still cited.');
  assert.equal((await ctx.call('POST', `/reviews/${id}/complete`)).status, 409);

  assert.equal((await decide('Practice note 2022', { outcome: 'update', content: 'New note.', expected_version: 1 })).status, 200);
  assert.equal((await decide('Breach Notification Regulations 2026', { outcome: 'add', title: 'Regs 2026', content: '72h.' })).status, 200);
  assert.equal((await decide('Odom', { outcome: 'no_change', reason: 'Needs research first.' })).status, 200);
  assert.equal((await decide('Ghost', { outcome: 'no_change', reason: 'Unknown record.' })).status, 200);

  assert.equal((await ctx.call('PUT', `/reviews/${id}/summary`, { text: 'Reviewed summary.', confirmed: true })).status, 200);
  assert.equal((await ctx.call('PUT', `/reviews/${id}/summary`, { text: 'Edited again.' })).body.summary_confirmed, false);
  assert.equal((await ctx.call('POST', `/reviews/${id}/complete`)).status, 409);
  assert.equal((await ctx.call('GET', `/reviews/${id}/report`)).status, 409);

  const manual = await ctx.call('POST', `/cases/${CASE}/records`, { title: 'Meeting note', content: 'Manual add.', review_id: id, reason: 'Captured in review.' });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));

  await ctx.call('PUT', `/reviews/${id}/summary`, { text: 'Final summary.', confirmed: true });
  const done = await ctx.call('POST', `/reviews/${id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await ctx.call('PUT', `/reviews/${id}/summary`, { text: 'late', confirmed: true })).status, 409);

  const rep = (await ctx.call('GET', `/reviews/${id}/report`)).body;
  assert.equal(rep.summary, 'Final summary.');
  assert.equal(rep.review.completed_by, 'Test Reviewer');
  assert.equal(rep.decisions.length, 1);
  assert.equal(rep.questions.length, 1);
  assert.equal(rep.follow_ups[0].owner, null);
  assert.equal(rep.suggestions.length, 5);
  assert.ok(rep.suggestions.every(s => s.decision));
  assert.equal(rep.changes.added.length, 2);
  assert.equal(rep.changes.updated.length, 1);
  assert.equal(rep.changes.retained.length, 1);
  const actions = rep.audit.map(e => e.action);
  for (const a of ['review.created', 'analysis.completed', 'suggestion.update', 'record.manual_add', 'summary.confirmed', 'review.completed']) assert.ok(actions.includes(a), a);
  assert.deepEqual([...rep.audit].sort((a, b) => a.id - b.id), rep.audit);
});

test('zero suggestions still requires explicit completion (AC09)', async t => {
  const ctx = await setup(t, stub({ ...OUTPUT, suggestions: [] }));
  const { id, review } = await analyzed(ctx);
  assert.equal(review.suggestions.length, 0);
  assert.equal(review.analysis.discarded, 0);
  assert.equal((await ctx.call('POST', `/reviews/${id}/complete`)).status, 409);
  await ctx.call('PUT', `/reviews/${id}/summary`, { text: review.review.reviewed_summary, confirmed: true });
  assert.equal((await ctx.call('POST', `/reviews/${id}/complete`)).status, 200);
});

test('case isolation: review in case A cannot touch case B (AC10)', async t => {
  const ctx = await setup(t);
  const b = await ctx.call('POST', '/cases', { title: 'Case B' });
  assert.equal(b.status, 201);
  const rb = await ctx.call('POST', `/cases/${b.body.id}/records`, { id: 'B1', title: 'B record', content: 'B content' });
  assert.equal(rb.status, 201);
  const before = ctx.snapshot();
  const { id, by } = await analyzed(ctx);
  assert.ok(ctx.analyzer.calls[0].records.every(r => r.id !== 'B1'));
  const d = await ctx.call('POST', `/suggestions/${by('Odom').id}/decide`, { outcome: 'update', target_record_id: 'B1', content: 'hijack', expected_version: 1, reason: 'x' });
  assert.equal(d.status, 404);
  const m = await ctx.call('PUT', `/cases/${b.body.id}/records/B1`, { content: 'hijack', expected_version: 1, review_id: id });
  assert.equal(m.status, 400);
  assert.equal(ctx.snapshot(), before);
});

test('CSV import validates all rows before importing', async t => {
  const ctx = await setup(t);
  const bad = await ctx.call('POST', `/cases/${CASE}/import`, { csv: 'id,title,content,source_ref\nX1,Ok,"Has, comma",s\nLD00002767,Dup,c,s\nX2,,c,s\n' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors.length, 2);
  const ok = await ctx.call('POST', `/cases/${CASE}/import`, { csv: '\uFEFFid,title,content,source_ref\r\nX1,Ok,"Has, comma ""quoted""",s\r\n' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const rec = (await ctx.call('GET', `/cases/${CASE}`)).body.records.find(r => r.id === 'X1');
  assert.equal(rec.content, 'Has, comma "quoted"');
});

test('parseCsv handles quotes and embedded newlines', () => {
  assert.deepEqual(parseCsv('a,b\n"x\ny","z ""q"""\n'), [['a', 'b'], ['x\ny', 'z "q"']]);
});

test('validateOutput rejects output without a summary', () => {
  assert.throws(() => validateOutput({ suggestions: [] }, [], []), /summary/);
});
