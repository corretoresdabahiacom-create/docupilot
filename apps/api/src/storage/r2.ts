import { AwsClient } from 'aws4fetch';
import { hexToBase64 } from '../auth/crypto';
import type { SignedUpload, StorageProvider } from './types';

export interface R2Options {
  bucket: R2Bucket;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

/**
 * R2 com URLs pré-assinadas (S3 API). O binding do Worker não gera URLs assinadas, por isso
 * usa aws4fetch; leitura/exclusão usam o binding.
 */
export class R2Storage implements StorageProvider {
  readonly name = 'r2';
  readonly verifiesChecksumOnUpload = true;
  private readonly client: AwsClient;

  constructor(private readonly o: R2Options) {
    this.client = new AwsClient({
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
  }

  private objectUrl(key: string): URL {
    return new URL(
      `https://${this.o.accountId}.r2.cloudflarestorage.com/${this.o.bucketName}/${key}`,
    );
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    sha256Hex: string;
    expiresInSeconds: number;
  }): Promise<SignedUpload> {
    const url = this.objectUrl(input.key);
    url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
    // O checksum entra na assinatura: o R2 rejeita o PUT se o conteúdo não tiver esse SHA-256.
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

  async head(key: string) {
    const obj = await this.o.bucket.head(key);
    return obj ? { size: obj.size } : null;
  }

  async readRange(key: string, offset: number, length: number) {
    const obj = await this.o.bucket.get(key, { range: { offset, length } });
    if (!obj) throw new Error('object not found');
    return new Uint8Array(await obj.arrayBuffer());
  }

  async delete(key: string) {
    await this.o.bucket.delete(key);
  }

  async deleteMany(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.o.bucket.delete(keys.slice(i, i + 1000));
    }
  }
}
