import { AwsClient } from 'aws4fetch';
import { hexToBase64 } from '../auth/crypto';
import type { SignedUpload, StorageProvider } from './types';

export interface SupabaseS3Options {
  /** Ex.: https://<ref>.storage.supabase.co/storage/v1/s3 */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Injetável nos testes; em produção é o fetch do Worker. */
  fetchFn?: typeof fetch;
}

/**
 * Supabase Storage pela API compatível com S3 (plano B do R2, D2). Tudo vai por HTTP assinado
 * (SigV4), sem binding. O Supabase não confirma o SHA-256 declarado no envio, então
 * `verifiesChecksumOnUpload` é false e o hash fica registrado como "não verificado pelo
 * armazenamento" (document_hashes.verified_by_storage = false).
 */
export class SupabaseStorage implements StorageProvider {
  readonly name = 'supabase';
  readonly verifiesChecksumOnUpload = false;
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly o: SupabaseS3Options) {
    this.client = new AwsClient({
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      service: 's3',
      region: o.region,
    });
    this.base = o.endpoint.replace(/\/+$/, '');
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
  }

  private objectUrl(key: string): URL {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return new URL(`${this.base}/${encodeURIComponent(this.o.bucket)}/${path}`);
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    sha256Hex: string;
    expiresInSeconds: number;
  }): Promise<SignedUpload> {
    const url = this.objectUrl(input.key);
    url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
    // O cabeçalho entra na assinatura; se o Supabase não o conferir, o hash segue "não verificado".
    const headers = {
      'x-amz-checksum-sha256': hexToBase64(input.sha256Hex),
      'content-type': input.contentType,
    };
    const signed = await this.client.sign(new Request(url, { method: 'PUT', headers }), {
      aws: { signQuery: true },
    });
    return { url: signed.url, method: 'PUT', headers };
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const url = this.objectUrl(key);
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    const signed = await this.client.sign(new Request(url, { method: 'GET' }), {
      aws: { signQuery: true },
    });
    return signed.url;
  }

  private async call(key: string, init: RequestInit): Promise<Response> {
    const req = await this.client.sign(this.objectUrl(key), init);
    return this.fetchFn(req);
  }

  async head(key: string) {
    const res = await this.call(key, { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage head failed (${res.status})`);
    const size = Number(res.headers.get('content-length'));
    return Number.isFinite(size) ? { size } : null;
  }

  async readRange(key: string, offset: number, length: number) {
    if (length <= 0) return new Uint8Array();
    const res = await this.call(key, {
      method: 'GET',
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (res.status === 404) throw new Error('object not found');
    if (!res.ok) throw new Error(`storage read failed (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // Se o servidor ignorar o Range e devolver tudo, corta aqui.
    return res.status === 206 ? buf : buf.slice(offset, offset + length);
  }

  async delete(key: string) {
    const res = await this.call(key, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${res.status})`);
  }

  /** Um DELETE por chave, em grupos de 10 (o DeleteObjects em lote não foi verificado no Supabase). */
  async deleteMany(keys: string[]) {
    for (let i = 0; i < keys.length; i += 10) {
      await Promise.all(keys.slice(i, i + 10).map((k) => this.delete(k)));
    }
  }
}
