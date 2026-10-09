# RippleWise MVP Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build RippleWise, the case → transcript → review → audit web app from the PRD.

**Architecture:** One Node process: Express API over `node:sqlite`; React/Vite frontend served via Vite middleware (dev) or `dist/` (prod). Bedrock Converse via `fetch` with a bearer API key; missing key → analysis fails cleanly.

**Tech Stack:** Node 24, Express 5, node:sqlite, React 19, Vite, Framer Motion, node:test.

Spec: `docs/superpowers/specs/2026-10-09-ripplewise-design.md`

---

## Chunk 1: Server

### Task 1: Scaffold
- [ ] `package.json` (type module; scripts `dev`, `build`, `start`, `test`), `.env.example`, `.gitignore`.
- [ ] `npm install express react react-dom framer-motion` + dev `vite @vitejs/plugin-react`.

### Task 2: DB + seed (`server/db.js`, `server/seed/`)
- [ ] Schema from spec; `openDb(path)`; `seedDemo(db)` inserts demo case + 8 records (version 1) if no cases exist.
- [ ] `server/seed/demo-case.json` built from `center_data/C_legal/legal_documents.csv`; `demo-transcript.txt`.

### Task 3: Analyzer (`server/analyze.js`)
- [ ] `bedrockAnalyzer({ apiKey, region, modelId })` → `analyze({ paragraphs, records })` returning parsed JSON; throws `Bedrock key not configured` when key missing/placeholder.
- [ ] `validateOutput(output, paragraphs, records)` → drops suggestions without valid refs, downgrades unknown targets to `needs_review`.

### Task 4: API (`server/app.js`) — test first (`test/api.test.js`)
- [ ] Write tests for AC01–AC07, AC09, AC10 with stub analyzer; run, see fail.
- [ ] Implement routes per spec; transactions for decide; 409 on resolved/stale; reason required on override.
- [ ] `npm test` passes.

### Task 5: CSV import (`server/csv.js`)
- [ ] Parser + import endpoint with per-row errors; covered by a test.

## Chunk 2: Web

### Task 6: Shell + styles (`web/index.html`, `web/src/main.jsx`, `web/src/styles.css`, `web/src/api.js`)
- [ ] Hash router, translucent toolbar, reviewer name (demo mode label), Apple-style tokens, reduced motion/transparency/contrast.

### Task 7: Screens (`web/src/screens/*.jsx`)
- [ ] CaseList, CaseWorkspace (records, Archived filter, version sheet, CSV import, reviews), NewReview (upload/paste, preview, analyze, failed + retry), Review (summary confirm, queue w/ progress, suggestion card, evidence panel, action controls), Report (sections + audit, print).
- [ ] `Sheet.jsx`: spring sheet, drag-to-dismiss with velocity projection.

### Task 8: Verify
- [ ] `npm test`, `npm run build`, `npm start`, smoke-test in browser: create review → analyze shows "Bedrock key not configured" failure; records unchanged.
