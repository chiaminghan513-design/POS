import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosApiService } from './pos-api.service';

describe('PosApiService', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('sends the scanned QR verification token to the backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    const service = TestBed.inject(PosApiService);

    await firstValueFrom(service.scanMember('+601298989899', 'signed-token'));

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/pos/member/scan', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ phone: '+601298989899', verificationToken: 'signed-token' })
    }));
  });

  it('uses the Swagger-backed merchant staff route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    const service = TestBed.inject(PosApiService);

    await firstValueFrom(service.getStaff());

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/pos/staff', expect.objectContaining({ method: 'GET' }));
  });

  it('validates a restored merchant session before using the counter', async () => {
    localStorage.setItem('pos_token', 'merchant-session');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ valid: true, merchantId: 'M-0025' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    const service = TestBed.inject(PosApiService);

    await firstValueFrom(service.validateSession());

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/pos/session', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer merchant-session' })
    }));
  });
});
