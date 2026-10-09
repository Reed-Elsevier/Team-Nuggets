# RippleWise

Team Nuggets · Central Philippine University

RippleWise traces what a meeting decided to the case records it affects. Upload a transcript and RippleWise (via AWS Bedrock) drafts a summary, the explicit decisions, open questions, follow-ups and evidence-linked record suggestions. A reviewer confirms every add / update / archive. Nothing changes without an explicit action, and every step is audited.

## Run it

Requires Node.js 22.13+ (tested on 24 LTS).

```powershell
npm install
copy .env.example .env      # then put your real key in BEDROCK_API_KEY
npm run dev                 # http://localhost:3000 (Express + Vite in one process)
```

Production: `npm run build` then `npm start`. Tests: `npm test`.

On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

## AI (AWS Bedrock)

| Variable | Purpose |
| --- | --- |
| `BEDROCK_API_KEY` | Bedrock API key. **Placeholder** `your-bedrock-api-key-here` until you have one. |
| `BEDROCK_REGION` | e.g. `us-east-1` |
| `BEDROCK_MODEL_ID` | Any Converse-capable model ID |

The key stays on the server. Without a real key, analysis shows **Failed — "Bedrock key not configured"** with a Retry button, and no records change. Restart the server after editing `.env`.

## Live Impact Forecast

The review page has a sticky **Impact forecast** panel on the right (collapsible on narrow screens). As the reviewer picks outcomes, it asks Bedrock what the current decisions could mean for the case. Picking the suggested action counts as approving, Retain/Dismiss/No change as rejecting, and **Defer** postpones a decision. The forecast shows potential case impact, possible risks and suggested next steps.

- Updates automatically, 650 ms after the last change, in the same panel. Confirmed decisions are included.
- Draft picks and deferrals are saved in the browser only. **Confirm** is still the only thing that changes records.
- Read-only: `POST /api/reviews/:id/forecast` never writes records, decisions or audit events. Output is labelled *AI-generated possible impacts, not confirmed outcomes*.

## Demo data

On first start the database (`data/ripplewise.db`) is seeded with one legal case: 8 Elmere data-protection records taken from `center_data/C_legal/legal_documents.csv`. On the New meeting review screen, **Use demo transcript** loads a meeting that supports an add, an update, an archive and one uncertain item. Delete `data/` to reset.

CSV import columns: `id, title, content, source_ref` (optional `type`).

## Layout

- `server/`: Express API (`app.js`), SQLite schema (`db.js`, built-in `node:sqlite`), Bedrock call and output validation (`analyze.js`), seed data
- `web/`: React + Framer Motion UI
- `test/`: API tests covering the PRD acceptance checks
- `docs/superpowers/`: design spec and plan
