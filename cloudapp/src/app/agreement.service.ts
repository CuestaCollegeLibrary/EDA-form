import { Injectable } from '@angular/core';
import { CloudAppConfigService, CloudAppRestService, HttpMethod } from '@exlibris/exl-cloudapp-angular-lib';
import { lastValueFrom } from 'rxjs';
import { AgreementConfig, DEFAULT_CONFIG, isSheetUrl, mergeConfig } from './agreement';

export class AlmaError extends Error {
  constructor(message: string, public notFound = false) { super(message); }
}

/** Turns an Alma/Cloud App error into a short readable message. */
function toAlmaError(e: any): AlmaError {
  // Alma sends errors either as errorList.error[] or as web_service_result.errorList.error
  const body = e && e.error;
  const list = body && ((body.errorList && body.errorList.error) || (body.web_service_result && body.web_service_result.errorList && body.web_service_result.errorList.error));
  const first = Array.isArray(list) ? list[0] : list;
  const code = first && first.errorCode;
  const msg = (first && first.errorMessage) || (e && e.message) || 'Unknown error';
  const notFound = e?.status === 404 || String(code) === '401861' || /not found|no user/i.test(msg);
  return new AlmaError(msg, notFound);
}

@Injectable({ providedIn: 'root' })
export class AgreementService {
  constructor(private rest: CloudAppRestService, private configService: CloudAppConfigService) {}

  async loadConfig(): Promise<AgreementConfig> {
    try { return mergeConfig(await lastValueFrom(this.configService.get())); }
    catch { return { ...DEFAULT_CONFIG }; }
  }

  saveConfig(cfg: AgreementConfig) { return lastValueFrom(this.configService.set(cfg)); }

  /**
   * Reads the published Google Sheet (CSV). Read-only. Only docs.google.com sheet links are fetched.
   * Sends no cookies and no data about patrons.
   */
  async fetchSheet(url: string): Promise<string> {
    if (!isSheetUrl(url)) { throw new Error('The sheet link in Settings is not a Google Sheets link.'); }
    let res: Response;
    try { res = await fetch(url.trim(), { credentials: 'omit', cache: 'no-store' }); }
    catch { throw new Error('Could not reach the sheet. The link may not be published, or the browser blocked it. You can paste the sheet instead.'); }
    if (!res.ok) { throw new Error(`The sheet returned an error (${res.status}). Check that it is published to the web as CSV.`); }
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) { throw new Error('The link returned a web page, not CSV data. Publish the responses tab as CSV and use that link.'); }
    return text;
  }

  /** Read one patron by any unique identifier (primary ID, barcode, other ID). Read-only. */
  async getUser(id: string): Promise<any> {
    try {
      return await lastValueFrom(this.rest.call({
        url: '/users/' + encodeURIComponent(id),
        method: HttpMethod.GET,
        queryParams: { user_id_type: 'all_unique', view: 'full', expand: 'none' },
      }));
    } catch (e) { throw toAlmaError(e); }
  }

  /** Read a patron from the link Alma gives for the open page. Read-only. */
  async getUserByLink(link: string): Promise<any> {
    try { return await lastValueFrom(this.rest.call({ url: link, method: HttpMethod.GET, queryParams: { view: 'full', expand: 'none' } })); }
    catch (e) { throw toAlmaError(e); }
  }

  /** Save a patron record. The app only ever calls this with a record that has one added note. */
  async putUser(user: any): Promise<any> {
    try {
      return await lastValueFrom(this.rest.call({
        url: '/users/' + encodeURIComponent(user.primary_id),
        method: HttpMethod.PUT,
        requestBody: user,
      }));
    } catch (e) { throw toAlmaError(e); }
  }
}
