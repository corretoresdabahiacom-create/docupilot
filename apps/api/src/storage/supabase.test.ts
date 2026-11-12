import { describe, expect, it, vi } from 'vitest';
import { createStorage } from './index';
import { SupabaseStorage } from './supabase';

const opts = {
  endpoint: 'https://abc.storage.supabase.co/storage/v1/s3/',
  region: 'sa-east-1',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  bucket: 'docs',
};
const SHA = 'ab'.repeat(32);

describe('SupabaseStorage', () => {
  it('assina URL de envio com expiração, checksum e content-type, sem vazar o segredo', async () => {
    const s = new SupabaseStorage(opts);
    const up = await s.createUploadUrl({
      key: 'ws/1/a b.pdf',
      contentType: 'application/pdf',
      sha256Hex: SHA,
      expiresInSeconds: 300,
    });
    const u = new URL(up.url);
    expect(u.origin + u.pathname).toBe(
      'https://abc.storage.supabase.co/storage/v1/s3/docs/ws/1/a%20b.pdf',
    );
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(u.searchParams.get('X-Amz-Credential')).toContain('/sa-east-1/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-checksum-sha256');
    expect(up.method).toBe('PUT');
    expect(up.headers['content-type']).toBe('application/pdf');
    expect(up.headers['x-amz-checksum-sha256']).toBe(Buffer.from(SHA, 'hex').toString('base64'));
    expect(up.url).not.toContain('SECRET');
  });

  it('URL de download é assinada para GET', async () => {
    const url = await new SupabaseStorage(opts).createDownloadUrl('k.pdf', 900);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url).toContain('/docs/k.pdf');
  });

  it('não promete verificação de checksum', () => {
    expect(new SupabaseStorage(opts).verifiesChecksumOnUpload).toBe(false);
  });

  it('head, leitura por faixa e exclusão usam requisições assinadas', async () => {
    const calls: Request[] = [];
    const fetchFn = vi.fn(async (req: Request) => {
      calls.push(req);
      if (req.method === 'HEAD')
        return new Response(null, { status: 200, headers: { 'content-length': '42' } });
      if (req.method === 'GET') return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const s = new SupabaseStorage({ ...opts, fetchFn });
    expect(await s.head('k')).toEqual({ size: 42 });
    expect(Array.from(await s.readRange('k', 10, 3))).toEqual([1, 2, 3]);
    await s.delete('k');
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.headers.get('range')).toBe('bytes=10-12');
    for (const c of calls) expect(c.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
  });

  it('head 404 → null; leitura 404 → erro; exclusão 404 é aceita; 500 falha', async () => {
    const status = { v: 404 };
    const fetchFn = (async () =>
      new Response(null, { status: status.v })) as unknown as typeof fetch;
    const s = new SupabaseStorage({ ...opts, fetchFn });
    expect(await s.head('k')).toBeNull();
    await expect(s.readRange('k', 0, 1)).rejects.toThrow('not found');
    await expect(s.delete('k')).resolves.toBeUndefined();
    status.v = 500;
    await expect(s.delete('k')).rejects.toThrow('500');
    await expect(s.head('k')).rejects.toThrow('500');
  });

  it('se o servidor ignorar o Range e devolver tudo, corta o trecho pedido', async () => {
    const fetchFn = (async () =>
      new Response(new Uint8Array([0, 1, 2, 3, 4]), { status: 200 })) as unknown as typeof fetch;
    const s = new SupabaseStorage({ ...opts, fetchFn });
    expect(Array.from(await s.readRange('k', 1, 2))).toEqual([1, 2]);
  });

  it('deleteMany apaga todas as chaves', async () => {
    const seen: string[] = [];
    const fetchFn = (async (req: Request) => {
      seen.push(new URL(req.url).pathname);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await new SupabaseStorage({ ...opts, fetchFn }).deleteMany(
      Array.from({ length: 25 }, (_, i) => `k${i}`),
    );
    expect(seen).toHaveLength(25);
  });
});

describe('createStorage', () => {
  const env = {
    SUPABASE_S3_ENDPOINT: 'https://abc.storage.supabase.co/storage/v1/s3',
    SUPABASE_S3_REGION: 'sa-east-1',
    SUPABASE_S3_ACCESS_KEY_ID: 'a',
    SUPABASE_S3_SECRET_ACCESS_KEY: 'b',
    SUPABASE_S3_BUCKET: 'docs',
  };
  it('sem nenhuma configuração: null (UI mostra "não configurado")', () => {
    expect(createStorage({} as never)).toBeNull();
  });
  it('com as 5 variáveis do Supabase: provider supabase', () => {
    expect(createStorage(env as never)?.name).toBe('supabase');
  });
  it('faltando uma variável ou endpoint sem HTTPS: null', () => {
    expect(createStorage({ ...env, SUPABASE_S3_BUCKET: undefined } as never)).toBeNull();
    expect(createStorage({ ...env, SUPABASE_S3_ENDPOINT: 'http://x/s3' } as never)).toBeNull();
  });
});
