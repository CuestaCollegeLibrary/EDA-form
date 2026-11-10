import { Component, OnInit } from '@angular/core';
import { AlertService } from '@exlibris/exl-cloudapp-angular-lib';
import { AgreementConfig, DEFAULT_CONFIG, isSheetUrl, noteText } from '../agreement';
import { AgreementService } from '../agreement.service';

// Admin settings page. Shared by everyone at Cuesta who uses the app.
@Component({
  selector: 'app-config',
  template: `
    <h1>Device Agreements settings</h1>
    <p class="help">These apply to all staff. Change the semester at the start of each term.</p>

    <mat-form-field class="full">
      <mat-label>Current semester</mat-label>
      <input matInput [(ngModel)]="cfg.semester" placeholder="e.g. Fall 2026" autocomplete="off">
    </mat-form-field>

    <mat-form-field class="full">
      <mat-label>Note text starts with</mat-label>
      <input matInput [(ngModel)]="cfg.notePrefix" autocomplete="off">
      <mat-hint>Note will read: “{{ preview }}”</mat-hint>
    </mat-form-field>

    <mat-form-field class="full">
      <mat-label>Alma note type code</mat-label>
      <input matInput [(ngModel)]="cfg.noteType" autocomplete="off">
      <mat-hint>Must match a type in Alma’s user note list. Test in the sandbox first.</mat-hint>
    </mat-form-field>

    <mat-form-field class="full">
      <mat-label>Signed-agreement sheet link (CSV)</mat-label>
      <input matInput [(ngModel)]="cfg.sheetUrl" autocomplete="off" placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv">
      <mat-hint>Google Sheets: File, Share, Publish to web, pick the responses tab and CSV, then paste the link here. Leave empty to paste lists by hand.</mat-hint>
    </mat-form-field>
    <p class="bad" role="alert" *ngIf="sheetBad">The sheet link must be a docs.google.com spreadsheet link.</p>

    <div class="checks">
      <mat-checkbox [(ngModel)]="cfg.popup">Show as a pop-up when staff open the patron</mat-checkbox>
      <mat-checkbox [(ngModel)]="cfg.userViewable">Let the patron see the note in Primo</mat-checkbox>
    </div>

    <div class="actions">
      <button mat-flat-button class="btn-main" (click)="save()" [disabled]="saving">Save</button>
      <button mat-button (click)="reset()" [disabled]="saving">Reset to defaults</button>
    </div>
  `,
  styles: [`button.btn-main:not(:disabled){background-color:#0b5cad !important;color:#fff !important} .full{width:100%} .help{color:#555} .bad{color:#7a1712;margin:0 0 8px} .checks{display:flex;flex-direction:column;gap:6px;margin:12px 0} .actions{display:flex;gap:8px}`],
})
export class ConfigComponent implements OnInit {
  cfg: AgreementConfig = { ...DEFAULT_CONFIG };
  saving = false;

  constructor(private svc: AgreementService, private alert: AlertService) {}

  async ngOnInit() { this.cfg = await this.svc.loadConfig(); }

  get sheetBad(): boolean { return !!this.cfg.sheetUrl.trim() && !isSheetUrl(this.cfg.sheetUrl); }

  get preview(): string { return noteText({ ...this.cfg, semester: this.cfg.semester || '…' }); }

  async save() {
    if (this.sheetBad) { this.alert.error('The sheet link must be a docs.google.com spreadsheet link.'); return; }
    this.saving = true;
    try { await this.svc.saveConfig(this.cfg); this.alert.success('Settings saved.'); }
    catch (e: any) { this.alert.error('Could not save settings: ' + (e?.message || e)); }
    this.saving = false;
  }

  reset() { this.cfg = { ...DEFAULT_CONFIG }; }
}
