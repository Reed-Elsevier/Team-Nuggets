# RippleWise MVP — Design

Source PRD: ImpactTrace MVP Product Requirements v1 (renamed to RippleWise). Requirement IDs (FR/AC) refer to that PRD.

## Stack

- Node.js LTS (24+), Express, built-in `node:sqlite` (no native deps).
- React + Vite + Framer Motion frontend. In dev, Vite runs as Express middleware (one process); `npm start` serves `dist/`.
- AI: AWS Bedrock Converse API via `fetch` with `Authorization: Bearer ${BEDROCK_API_KEY}`. Config in `.env` (`BEDROCK_API_KEY`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`). `.env.example` ships a placeholder key.
- No key configured → analysis status `failed` with "Bedrock key not configured", Retry available, nothing mutated.

## Layout

```
server/
  index.js      start server (Express + Vite middleware or static dist)
  app.js        Express routes (createApp(db, analyzer))
  db.js         schema + open/seed
  analyze.js    Bedrock call, prompt, output validation
  csv.js        small RFC-4180 parser
  seed/         demo-case.json (records from center_data C_legal), demo-transcript.txt
test/api.test.js  node:test API tests with stub analyzer
web/            React app (index.html, src/)
```

## Data model (SQLite, one DB, case-scoped)

- `cases(id, title, description, created_at)`
- `records(case_id, id, title, type, source_ref, status active|archived, version)` PK (case_id, id)
- `record_versions(case_id, record_id, version, title, content, source_ref, created_at, actor, review_id)`
- `reviews(id, case_id, title, meeting_date, transcript_id, paragraphs JSON, status, reviewer, summary_confirmed, reviewed_summary, created_at, updated_at, completed_at, completed_by)`
  - status: uploaded → analyzing → awaiting_review → in_review → completed; `failed` on analysis error.
- `analyses(id, review_id, model, record_versions JSON, output JSON, discarded, error, created_at)`
- `suggestions(id, analysis_id, review_id, action add|update|archive|needs_review, target_record_id, target_version, title, reason, refs JSON, proposed_content, status pending|resolved|superseded)`
- `decisions(suggestion_id, chosen_action, approved_content, reason, actor, created_at, resulting_version)`
- `audit_events(id, case_id, review_id, suggestion_id, actor, ts, action, target, before_version, after_version, outcome, detail JSON)`

- `transcripts(id, case_id, filename, original_text, created_at)` — original stored separately; review references `transcript_id`.

## Contracts

**Transcript intake.** Client accepts `.txt` (read with FileReader) or pasted text; server rejects whitespace-only text (400 "Transcript is empty") and text over 200,000 characters (400 with the limit). Paragraphs = blocks split on blank lines (or single lines if none), IDs `P1..Pn`. Title required; date optional.

**Analysis output (validated, stored in `analyses.output`).**
```json
{ "summary": "string",
  "decisions": [{ "text": "string", "refs": ["P3"] }],
  "questions": [{ "text": "string", "refs": ["P7"] }],
  "follow_ups": [{ "text": "string", "owner": "string|null", "due": "string|null", "refs": ["P9"] }],
  "suggestions": [{ "action": "add|update|archive|needs_review", "target_record_id": "string|null",
                    "title": "string", "reason": "string", "refs": ["P4"], "proposed_content": "string|null" }] }
```
Validation: refs filtered to existing paragraph IDs; a suggestion left with no valid refs is discarded and counted in `discarded` (shown as a warning, so "no changes" is never faked); update/archive whose target isn't an active record in this case → `needs_review` with target null; add with no proposed content → `needs_review`. Unparseable model output → analysis `failed` with retry.

**Retry.** Allowed when review is `failed` or `awaiting_review` with zero decisions. A new run marks prior pending suggestions `superseded`; once any decision exists, re-analysis returns 409 (decisions never overwritten).

**Decide** `POST /api/suggestions/:id/decide { outcome, target_record_id?, expected_version?, title?, content?, reason, actor }`.
- Allowed outcomes by suggested action: archive → `archive|retain`; update → `update|retain`; add → `add|dismiss`; needs_review → `add|update|archive|no_change`.
- `update` requires target + content + expected_version; `archive` requires target + expected_version; `add` requires title + content, new ID `R-<review>-<n>` (unique per case).
- `reason` defaults to the AI reason only when the outcome equals the suggested action; otherwise required (400).
- Every outcome (incl. retain/dismiss/no_change) writes a decision + audit event; mutations write record/version in the same transaction. Errors leave the suggestion pending; client shows the error and keeps controls enabled for retry.

**Summary.** `PUT /api/reviews/:id/summary { text, confirmed }`; any text change clears confirmation unless `confirmed: true` is sent with it.

**Manual changes.** `POST /api/cases/:id/records` and `PUT /api/cases/:id/records/:rid` (new version, `expected_version`) accept optional `review_id` + `reason`; audit events carry that review ID and appear in its report.

**Report** `GET /api/reviews/:id/report` → `{ case, review (title, date, reviewer, completed_by, completed_at), summary, decisions, questions, follow_ups, suggestions: [{ original AI fields, decision }], changes: { added, updated, archived, retained }, audit: [events chronological] }`. Only available for completed reviews; audit events are recorded as work happens.

## Rules enforced on the server

- Analysis never mutates records. Mutation only via `POST /api/suggestions/:id/decide` or manual record endpoints.
- Decision + mutation + audit event in one transaction. Already-resolved suggestion → 409 (duplicate click safe).
- Update/archive carry `expected_version`; mismatch → 409 stale, suggestion stays pending.
- Override or reject (action differs from suggested) requires a reviewer reason.
- AI output validation: unknown/other-case record ID → `needs_review` with no target; refs must exist in transcript paragraphs, otherwise suggestion dropped; decisions stay separate from suggestions.
- Complete review requires confirmed summary and zero pending suggestions.
- All record queries filter by case ID (AC10). Any `review_id` on a write must belong to the routed case and not be completed; completed reviews reject summary edits, decisions and re-analysis (409).

## API

- `GET/POST /api/cases`, `GET /api/cases/:id` (records incl. archived, reviews)
- `GET /api/cases/:id/records/:rid/versions`
- `POST /api/cases/:id/records` (manual add), `POST /api/cases/:id/import` (CSV text)
- `POST /api/cases/:id/reviews` (title, date, transcript text) → paragraphs
- `POST /api/reviews/:id/analyze` (retry = new analysis run)
- `GET /api/reviews/:id` (review, latest analysis, suggestions, decisions)
- `PUT /api/reviews/:id/summary` (text, confirmed)
- `POST /api/suggestions/:id/decide`
- `POST /api/reviews/:id/complete`
- `GET /api/reviews/:id/report` (report + audit)

## UI

Screens via hash routing: Case list → Case workspace → New review (upload + preview + analyze) → Review workspace → Report & audit. Demo reviewer name stored in localStorage, labelled "Demo mode — no sign-in".

Apple-style: system font, size-specific tracking, translucent sticky toolbar, press feedback on pointer-down, critically damped springs for sheets (bounce only after a flick), drag-to-dismiss sheet with velocity projection, `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast` support.

## Seed

Demo case "Veritas Legal — Data Protection Precedent Review" with ~8 records from `center_data/C_legal/legal_documents.csv` (doc_id as stable ID, content = summary + headnote, source_ref = citation + CSV location). Demo transcript supports one update, one add, one archive and one uncertain item.

## Testing

`node --test` against `createApp` with an in-memory DB and stub analyzer: missing key fails cleanly and leaves records unchanged (AC01/AC07), empty/oversize input (AC07), retain/archive/update/add/dismiss (AC02–AC05), persistence, summary-edit revokes confirmation & completion gate (AC06), duplicate click + stale version + injected DB write failure rolls back mutation + decision + audit and the suggestion stays pending, then retry succeeds (AC07 failed save), retry supersedes only when no decisions exist, zero suggestions + discarded-count (AC09), case isolation + ref validation (AC10), manual in-review change appears in report audit, full report contents (AC08).

Completion races: `node:sqlite` is synchronous and each handler runs in one transaction on Node's single thread, so a completion request can't interleave with a decision write; the client also disables Complete while a save is in flight or the last save failed.

## Out of scope

Authentication, Parquet upload, multi-stage approval, collaboration, PDF export (browser print instead).
