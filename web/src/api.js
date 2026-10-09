export const reviewer = {
  get: () => localStorage.getItem('rw.reviewer') || '',
  set: v => localStorage.setItem('rw.reviewer', v.trim()),
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-reviewer': encodeURIComponent(reviewer.get()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data;
}

// Mirrors server/app.js splitParagraphs so the preview matches stored paragraph IDs.
export function splitParagraphs(raw) {
  let blocks = raw.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean);
  if (blocks.length === 1) blocks = blocks[0].split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return blocks.map((t, i) => ({ id: `P${i + 1}`, text: t }));
}

export const go = hash => { location.hash = hash; };
export const fmtDate = s => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const STATUS_LABEL = {
  uploaded: 'Uploaded', analyzing: 'Analyzing', awaiting_review: 'Awaiting review',
  in_review: 'In review', completed: 'Completed', failed: 'Failed',
};
export const ACTION_LABEL = {
  add: 'Add', update: 'Update', archive: 'Archive', needs_review: 'Needs review',
  retain: 'Retain', dismiss: 'Dismiss', no_change: 'No change',
};
