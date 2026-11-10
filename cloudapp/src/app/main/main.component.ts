import { Component, OnDestroy, OnInit } from '@angular/core';
import { CloudAppEventsService, EntityType } from '@exlibris/exl-cloudapp-angular-lib';
import { Subscription } from 'rxjs';
import {
  AgreementConfig, DEFAULT_CONFIG, displayName, extractSignups, hasAgreement, mapLimit, nameMatches, noteText, withAgreementNote,
} from '../agreement';
import { AgreementService } from '../agreement.service';

type RowStatus = 'waiting' | 'checking' | 'ready' | 'review' | 'already' | 'notfound' | 'error' | 'adding' | 'added' | 'unverified';

interface BulkRow {
  id: string;
  status: RowStatus;
  name?: string;
  message?: string;
  user?: any;
  formName?: string;   // name typed on the form, when the list came from the sheet
  approved?: boolean;  // staff ticked "add anyway" on a row whose name did not match
}

const MAX_IDS = 500;

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
})
export class MainComponent implements OnInit, OnDestroy {
  cfg: AgreementConfig = { ...DEFAULT_CONFIG };
  semester = '';
  private sub?: Subscription;

  // ---- one patron ----
  lookupId = '';
  patron: any = null;
  patronBusy = false;
  patronMessage = '';
  patronError = '';
  private fromPage = false;

  // ---- list ----
  pasteText = '';
  parsedSummary = '';
  rows: BulkRow[] = [];
  stage: 'input' | 'checked' | 'done' = 'input';
  busy = false;
  progress = 0;
  confirmed = false;
  rejected: string[] = [];
  sheetBusy = false;
  sheetError = '';

  constructor(private svc: AgreementService, private events: CloudAppEventsService) {}

  async ngOnInit() {
    this.cfg = await this.svc.loadConfig();
    this.semester = this.cfg.semester;
    this.sub = this.events.entities$.subscribe(entities => {
      const user = (entities || []).find(e => e.type === EntityType.USER);
      if (user) { this.fromPage = true; this.openPatron(() => this.svc.getUserByLink(user.link)); }
      else if (this.fromPage) { this.fromPage = false; this.patron = null; this.patronMessage = ''; }
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  // Config with whatever semester is typed in the box right now.
  get live(): AgreementConfig { return { ...this.cfg, semester: (this.semester || '').trim() }; }
  get semesterOk(): boolean { return this.live.semester.length > 0; }
  get noteExample(): string { return this.semesterOk ? noteText(this.live) : ''; }

  // ---------------- one patron ----------------
  lookup() {
    const id = this.lookupId.trim();
    if (!id) { return; }
    this.fromPage = false;
    this.openPatron(() => this.svc.getUser(id));
  }

  private async openPatron(load: () => Promise<any>) {
    this.patronBusy = true; this.patronError = ''; this.patronMessage = ''; this.patron = null;
    try { this.patron = await load(); }
    catch (e: any) { this.patronError = e.notFound ? 'No patron found with that ID.' : 'Could not read the patron: ' + e.message; }
    this.patronBusy = false;
  }

  get patronName(): string { return displayName(this.patron); }
  get patronHas(): boolean { return !!this.patron && hasAgreement(this.patron, this.live); }

  async markSigned() {
    if (!this.patron || !this.semesterOk) { return; }
    this.patronBusy = true; this.patronError = ''; this.patronMessage = '';
    try {
      const { user, changed } = withAgreementNote(this.patron, this.live);
      if (!changed) { this.patronMessage = 'Already recorded. Nothing changed.'; }
      else {
        const saved = await this.svc.putUser(user);
        if (hasAgreement(saved, this.live)) { this.patron = saved; this.patronMessage = 'Saved. The note is on the patron record.'; }
        else { this.patronError = 'Alma accepted the change but the note was not found afterwards. Check the patron in Alma.'; }
        if (this.fromPage) { this.events.refreshPage().subscribe(); }
      }
    } catch (e: any) { this.patronError = 'Could not save: ' + e.message; }
    this.patronBusy = false;
  }

  // ---------------- list ----------------
  onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = () => { this.pasteText = String(reader.result || ''); this.readList(); };
    reader.readAsText(file);
  }

  get hasSheet(): boolean { return !!this.cfg.sheetUrl; }

  /** Reads the published sheet. Changes nothing in Alma. */
  async loadSheet() {
    if (this.sheetBusy || this.busy) { return; }
    this.sheetError = '';
    if (!this.semesterOk) { this.sheetError = 'Enter the semester first, so only this semester’s sign-ups are used.'; return; }
    this.sheetBusy = true;
    try {
      this.pasteText = await this.svc.fetchSheet(this.cfg.sheetUrl);
      this.readList();
    } catch (e: any) { this.sheetError = e.message || String(e); }
    this.sheetBusy = false;
  }

  readList() {
    const res = extractSignups(this.pasteText, this.live.semester);
    this.rejected = res.rejected;
    const capped = res.signups.slice(0, MAX_IDS);
    this.rows = capped.map(s => ({ id: s.id, status: 'waiting' as RowStatus, formName: s.name }));
    this.stage = 'input';
    this.confirmed = false;
    const parts = [`${res.signups.length} student IDs found (from ${res.source}).`];
    if (res.semesterFiltered) { parts.push(`Only rows for ${this.live.semester} were used; ${res.otherSemester} from other semesters skipped.`); }
    if (res.duplicates) { parts.push(`${res.duplicates} repeats ignored.`); }
    if (res.rejected.length) { parts.push(`${res.rejected.length} entries skipped because they are not 9 digits.`); }
    if (res.signups.length > MAX_IDS) { parts.push(`Only the first ${MAX_IDS} will be used. Run the rest separately.`); }
    this.parsedSummary = parts.join(' ');
  }

  /** Step 1: look every patron up. Changes nothing in Alma. */
  async check() {
    if (!this.rows.length || this.busy) { return; }
    this.busy = true; this.progress = 0; this.confirmed = false;
    const cfg = this.live;
    await mapLimit(this.rows, 3, async (row) => {
      row.status = 'checking'; row.message = ''; row.name = ''; row.user = undefined;
      try {
        const user = await this.svc.getUser(row.id);
        row.name = displayName(user);
        if (hasAgreement(user, cfg)) { row.status = 'already'; }
        else if (row.formName && nameMatches(row.formName, user) === false) {
          row.status = 'review'; row.user = user; row.approved = false;
          row.message = 'Name on the form does not match Alma';
        } else { row.status = 'ready'; row.user = user; }
      } catch (e: any) {
        row.status = e.notFound ? 'notfound' : 'error';
        row.message = e.notFound ? 'No patron with this ID' : e.message;
      }
    }, n => this.progress = n);
    this.stage = 'checked';
    this.busy = false;
  }

  /** Step 2: add the note, only to patrons who were found and do not have it yet. */
  async apply() {
    if (!this.confirmed || this.busy) { return; }
    this.busy = true; this.progress = 0;
    const cfg = this.live;
    const todo = this.rows.filter(r => (r.status === 'ready' || (r.status === 'review' && r.approved)) && r.user);
    await mapLimit(todo, 2, async (row) => {
      row.status = 'adding';
      try {
        const { user, changed } = withAgreementNote(row.user, cfg);
        if (!changed) { row.status = 'already'; return; }
        const saved = await this.svc.putUser(user);
        row.status = hasAgreement(saved, cfg) ? 'added' : 'unverified';
        if (row.status === 'unverified') { row.message = 'Saved, but the note was not seen afterwards. Check in Alma.'; }
      } catch (e: any) { row.status = 'error'; row.message = e.message; }
      row.user = undefined;
    }, n => this.progress = n);
    this.stage = 'done';
    this.busy = false;
    this.confirmed = false;
  }

  count(...s: RowStatus[]): number { return this.rows.filter(r => s.includes(r.status)).length; }
  get readyCount() { return this.rows.filter(r => r.status === 'ready' || (r.status === 'review' && r.approved)).length; }

  label(s: RowStatus): string {
    return ({
      waiting: 'Not checked', checking: 'Checking…', ready: 'Will add note', review: 'Check name', already: 'Already has note',
      notfound: 'Not found', error: 'Error', adding: 'Adding…', added: 'Note added', unverified: 'Check in Alma',
    } as any)[s];
  }

  /** CSV of anything that was not a clean success. Contains IDs and results only, no names. */
  downloadReport() {
    const lines = ['student_id,result,detail'];
    this.rows.forEach(r => {
      const detail = (r.message || '').replace(/"/g, '""');
      lines.push(`${r.id},${this.label(r.status)},"${detail}"`);
    });
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `device-agreement-run-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  reset() { this.rows = []; this.pasteText = ''; this.parsedSummary = ''; this.stage = 'input'; this.confirmed = false; this.rejected = []; }
}
