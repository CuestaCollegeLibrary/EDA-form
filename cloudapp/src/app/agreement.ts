// Pure logic for the Device Agreements app. No Angular, no network: easy to test.

export interface AgreementConfig {
  semester: string;      // e.g. "Fall 2026"
  noteType: string;      // Alma user note type code, e.g. "LIBRARY"
  notePrefix: string;    // e.g. "Device agreement signed"
  popup: boolean;        // show the note as a pop-up when staff open the patron
  userViewable: boolean; // let the patron see the note in Primo
  sheetUrl: string;      // "Publish to web" CSV link of the signed-agreement response sheet (may be empty)
}

export const DEFAULT_CONFIG: AgreementConfig = {
  semester: '',
  noteType: 'LIBRARY',
  notePrefix: 'Device agreement signed',
  popup: true,
  userViewable: false,
  sheetUrl: '',
};

export function mergeConfig(stored: any): AgreementConfig {
  const c = { ...DEFAULT_CONFIG };
  if (stored && typeof stored === 'object') {
    if (typeof stored.semester === 'string') { c.semester = stored.semester.trim(); }
    if (typeof stored.noteType === 'string' && stored.noteType.trim()) { c.noteType = stored.noteType.trim(); }
    if (typeof stored.notePrefix === 'string' && stored.notePrefix.trim()) { c.notePrefix = stored.notePrefix.trim(); }
    if (typeof stored.popup === 'boolean') { c.popup = stored.popup; }
    if (typeof stored.userViewable === 'boolean') { c.userViewable = stored.userViewable; }
    if (typeof stored.sheetUrl === 'string') { c.sheetUrl = stored.sheetUrl.trim(); }
  }
  return c;
}

const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The exact note text this app writes, e.g. "Device agreement signed - Fall 2026". */
export function noteText(cfg: AgreementConfig): string {
  return `${cfg.notePrefix} - ${cfg.semester}`.trim();
}

/** True if the patron already has a note for this semester. Matching ignores case and spacing. */
export function hasAgreement(user: any, cfg: AgreementConfig): boolean {
  const target = norm(noteText(cfg));
  const notes = user && Array.isArray(user.user_note) ? user.user_note : [];
  return notes.some((n: any) => norm(n && n.note_text).includes(target));
}

/**
 * Returns a copy of the user with one agreement note added. Never removes or edits anything else.
 * If the patron already has the note for this semester, nothing changes.
 */
export function withAgreementNote(user: any, cfg: AgreementConfig): { user: any; changed: boolean } {
  if (hasAgreement(user, cfg)) { return { user, changed: false }; }
  const copy = JSON.parse(JSON.stringify(user));
  if (!Array.isArray(copy.user_note)) { copy.user_note = []; }
  copy.user_note.push({
    segment_type: 'Internal',
    note_type: { value: cfg.noteType },
    note_text: noteText(cfg),
    user_viewable: cfg.userViewable,
    popup_note: cfg.popup,
  });
  return { user: copy, changed: true };
}

export function displayName(user: any): string {
  if (!user) { return ''; }
  const last = user.last_name || '';
  const first = user.first_name || '';
  return [last, first].filter(Boolean).join(', ') || user.primary_id || '';
}

// ---- Reading a list of student IDs from pasted text or a CSV/TSV file ----

/** Splits delimited text into rows of cells. Handles quoted cells and tab, comma or semicolon separators. */
export function parseDelimited(text: string): string[][] {
  const clean = (text || '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else { cell += ch; }
    } else if (ch === '"') { quoted = true; }
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') { i++; }
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) { rows.push(row); }
      row = [];
    } else { cell += ch; }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) { rows.push(row); }
  return rows;
}

export interface IdParseResult {
  ids: string[];        // unique 9-digit IDs, in the order first seen
  duplicates: number;   // repeated IDs that were dropped
  rejected: string[];   // number-like cells that are not 9 digits (to show staff)
  source: string;       // which column the IDs came from, for display
}

export function extractStudentIds(text: string): IdParseResult {
  const rows = parseDelimited(text);
  const out: IdParseResult = { ids: [], duplicates: 0, rejected: [], source: 'all cells' };
  if (!rows.length) { return out; }

  // If the first row looks like a header, use the column named like "Student ID" / "900#".
  // A plain "ID" header is ignored on purpose: Microsoft Forms exports put a response number there.
  let col = -1;
  let start = 0;
  const header = rows[0].map(c => c.trim());
  if (header.some(c => /[a-z]/i.test(c))) {
    start = 1;
    col = header.findIndex(c => /(student|university)/i.test(c) && /(id|number|#)/i.test(c));
    if (col < 0) { col = header.findIndex(c => /900/.test(c)); }
    if (col >= 0) { out.source = `column "${header[col]}"`; }
  }

  const seen = new Set<string>();
  for (let r = start; r < rows.length; r++) {
    const cells = col >= 0 ? [rows[r][col] ?? ''] : rows[r];
    for (const raw of cells) {
      const v = (raw || '').trim().replace(/^'+/, '');
      if (!v) { continue; }
      if (/^\d{9}$/.test(v)) {
        if (seen.has(v)) { out.duplicates++; } else { seen.add(v); out.ids.push(v); }
      } else if (/^\d+$/.test(v) && col >= 0) {
        out.rejected.push(v);
      }
    }
  }
  return out;
}

// ---- Google Sheet sign-ups: IDs plus names and semester, so the app can check before it writes ----

/** True only for a Google Sheets address. The app refuses to fetch anything else. */
export function isSheetUrl(url: string): boolean {
  try {
    const u = new URL((url || '').trim());
    return u.protocol === 'https:' && u.hostname === 'docs.google.com' && u.pathname.startsWith('/spreadsheets/');
  } catch { return false; }
}

export interface Signup { id: string; name: string; }

export interface SignupParseResult {
  signups: Signup[];
  duplicates: number;
  rejected: string[];
  otherSemester: number;   // rows skipped because their Semester cell is a different term
  source: string;
  semesterFiltered: boolean;
}

/**
 * Reads sign-ups from sheet/CSV text. Uses the Student ID column, the Name column and, if there is a
 * Semester column, keeps only rows for the semester given. Falls back to a plain list of IDs.
 */
export function extractSignups(text: string, semester: string): SignupParseResult {
  const rows = parseDelimited(text);
  const base = extractStudentIds(text);
  const result: SignupParseResult = {
    signups: base.ids.map(id => ({ id, name: '' })),
    duplicates: base.duplicates, rejected: base.rejected, otherSemester: 0, source: base.source, semesterFiltered: false,
  };
  if (!rows.length) { return result; }
  const header = rows[0].map(c => c.trim());
  if (!header.some(c => /[a-z]/i.test(c))) { return result; }
  let idCol = header.findIndex(c => /(student|university)/i.test(c) && /(id|number|#)/i.test(c));
  if (idCol < 0) { idCol = header.findIndex(c => /900/.test(c)); }
  if (idCol < 0) { return result; }   // no recognisable ID column: keep the plain-ID result

  let nameCol = header.findIndex(c => /^\s*(full\s+|student\s+)?name\s*$/i.test(c));
  if (nameCol < 0) { nameCol = header.findIndex(c => /name/i.test(c) && !/(e-?mail|user)/i.test(c)); }
  const semCol = header.findIndex(c => /(semester|term)/i.test(c));
  const wantSem = norm(semester);
  const filter = semCol >= 0 && wantSem.length > 0;

  result.signups = []; result.duplicates = 0; result.rejected = []; result.semesterFiltered = filter;
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (filter && norm(row[semCol] || '') !== wantSem) { result.otherSemester++; continue; }
    const v = (row[idCol] || '').trim().replace(/^'+/, '');
    if (!v) { continue; }
    if (/^\d{9}$/.test(v)) {
      if (seen.has(v)) { result.duplicates++; continue; }
      seen.add(v);
      result.signups.push({ id: v, name: nameCol >= 0 ? (row[nameCol] || '').trim() : '' });
    } else if (/^\d+$/.test(v)) { result.rejected.push(v); }
  }
  return result;
}

const tokens = (s: string): string[] =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Does the name typed on the form fit the patron in Alma?
 * true = last name and first name (or first initial) both appear; false = they do not; null = nothing to compare.
 */
export function nameMatches(formName: string, user: any): boolean | null {
  const form = tokens(formName);
  const last = tokens(user && user.last_name);
  const first = tokens(user && user.first_name);
  if (!form.length || !last.length) { return null; }
  const lastOk = last.every(t => form.includes(t));
  const firstOk = !first.length || form.includes(first[0]) || form.some(t => t.length === 1 && t === first[0][0]);
  return lastOk && firstOk;
}

/** Runs fn over items with at most `limit` running at once. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) { return; }
      results[i] = await fn(items[i], i);
      done++;
      if (onProgress) { onProgress(done); }
    }
  });
  await Promise.all(workers);
  return results;
}
