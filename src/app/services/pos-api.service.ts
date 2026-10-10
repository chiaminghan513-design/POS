import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PosApiService {
  private readonly baseUrl = environment.apiBaseUrl;
  login(merchantId: string, password: string) { return this.request('/pos/login', { method: 'POST', body: { merchantId, password } }, false); }
  validateSession() { return this.request<{ valid: boolean; merchantId: string }>('/pos/session'); }
  catalog() { return this.request('/pos/catalog'); }
  checkout(body: Record<string, unknown>) { return this.request('/pos/checkout', { method: 'POST', body }); }
  scanMember(phone: string, verificationToken = '') { return this.request('/pos/member/scan', { method: 'POST', body: { phone, verificationToken } }); }
  registerMember(body: Record<string, unknown>) { return this.request('/pos/member/register', { method: 'POST', body }); }
  action(action: string, body: Record<string, unknown>) { return this.request(`/pos/actions/${action}`, { method: 'POST', body }); }
  history(type: string) { return this.request(`/pos/history/${type}`); }
  memberHistory(type: string, phone: string) { return this.request(`/pos/member/history/${type}`, { method: 'POST', body: { phone } }); }
  notification(audience: 'all' | 'member', body: Record<string, unknown>) { return this.request(`/pos/notifications/${audience}`, { method: 'POST', body }); }
  eod(selectDate: string) { return this.request('/pos/eod', { method: 'POST', body: { selectDate } }); }
  topupDetails(topupId: string) { return this.request('/pos/topups/details', { method: 'POST', body: { topupId } }); }
  getStaff() { return this.request('/pos/staff'); }
  createStaff(body: { staffName: string; staffType: string; password: string; phoneNumber: string }) { return this.request('/pos/staff', { method: 'POST', body }); }
  deleteStaff(staffId: string) { return this.request(`/pos/staff/${encodeURIComponent(staffId)}/delete`, { method: 'POST', body: {} }); }

  private request<T = any>(path: string, options: { method?: string; body?: unknown } = {}, authenticated = true): Observable<T> {
    const token = localStorage.getItem('pos_token') || '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    const controller = new AbortController();
    const timeoutMs = path === '/pos/member/scan' ? 12_000 : 35_000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && token) headers['Authorization'] = `Bearer ${token}`;
    return from(fetch(`${this.baseUrl}${path}`, { method: options.method || 'GET', headers, signal: controller.signal, body: options.body === undefined ? undefined : JSON.stringify(options.body) }).then(async response => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw { status: response.status, error: payload };
      return payload as T;
    }).catch(error => {
      if (error?.name === 'AbortError') throw { status: 0, error: { message: 'The loyalty service took too long to respond. Please try the scan again.' } };
      if (!error?.status) throw { status: 0, error: { message: `The POS at ${window.location.origin} could not reach the local loyalty backend. Refresh the page and try again.` } };
      throw error;
    }).finally(() => window.clearTimeout(timeout)));
  }
}
