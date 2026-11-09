import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('envia cookies e o cabeçalho anti-CSRF', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('/auth/logout', { method: 'POST' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['x-requested-with']).toBe('docupilot');
  });
  it('converte erro da API em ApiError com o código', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'x' } }), {
          status: 429,
        }),
    );
    await expect(api('/x')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', status: 429 });
  });
  it('converte falha de rede em NETWORK', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
