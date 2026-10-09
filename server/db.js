import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  case_id TEXT NOT NULL REFERENCES cases(id), id TEXT NOT NULL, title TEXT NOT NULL, type TEXT,
  source_ref TEXT, status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (case_id, id));
CREATE TABLE IF NOT EXISTS record_versions (
  case_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL,
  content TEXT NOT NULL, source_ref TEXT, created_at TEXT NOT NULL, actor TEXT, review_id TEXT,
  PRIMARY KEY (case_id, record_id, version));
CREATE TABLE IF NOT EXISTS transcripts (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, filename TEXT, original_text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), title TEXT NOT NULL, meeting_date TEXT,
  transcript_id TEXT NOT NULL, paragraphs TEXT NOT NULL, status TEXT NOT NULL, reviewer TEXT,
  summary_confirmed INTEGER NOT NULL DEFAULT 0, reviewed_summary TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, completed_by TEXT);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL, model TEXT, record_versions TEXT, output TEXT,
  discarded INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, duration_ms INTEGER);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, review_id TEXT NOT NULL, action TEXT NOT NULL,
  target_record_id TEXT, target_version INTEGER, title TEXT, reason TEXT, refs TEXT NOT NULL,
  proposed_content TEXT, status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS decisions (
  suggestion_id TEXT PRIMARY KEY, review_id TEXT NOT NULL, chosen_action TEXT NOT NULL, target_record_id TEXT,
  approved_content TEXT, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, resulting_version INTEGER);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, review_id TEXT, suggestion_id TEXT,
  actor TEXT NOT NULL, ts TEXT NOT NULL, action TEXT NOT NULL, target TEXT, before_version INTEGER,
  after_version INTEGER, outcome TEXT, detail TEXT);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();

// Runs fn atomically: any throw rolls back every write made inside it.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, e) {
  db.prepare(`INSERT INTO audit_events (case_id, review_id, suggestion_id, actor, ts, action, target, before_version, after_version, outcome, detail)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    e.case_id, e.review_id ?? null, e.suggestion_id ?? null, e.actor, now(), e.action,
    e.target ?? null, e.before_version ?? null, e.after_version ?? null, e.outcome ?? null,
    e.detail ? JSON.stringify(e.detail) : null);
}

export function insertRecord(db, caseId, r, actor, reviewId = null) {
  db.prepare('INSERT INTO records (case_id, id, title, type, source_ref, status, version) VALUES (?,?,?,?,?,?,1)')
    .run(caseId, r.id, r.title, r.type ?? null, r.source_ref ?? null, 'active');
  db.prepare('INSERT INTO record_versions (case_id, record_id, version, title, content, source_ref, created_at, actor, review_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(caseId, r.id, 1, r.title, r.content, r.source_ref ?? null, now(), actor, reviewId);
}

export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM cases').get().n > 0) return;
  const seed = JSON.parse(readFileSync(new URL('./seed/demo-case.json', import.meta.url), 'utf8'));
  tx(db, () => {
    db.prepare('INSERT INTO cases (id, title, description, created_at) VALUES (?,?,?,?)')
      .run(seed.id, seed.title, seed.description, now());
    for (const r of seed.records) insertRecord(db, seed.id, r, 'seed');
    audit(db, { case_id: seed.id, actor: 'seed', action: 'case.seeded', outcome: `${seed.records.length} records` });
  });
}
