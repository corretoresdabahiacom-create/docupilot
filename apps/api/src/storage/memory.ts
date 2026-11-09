import type { SignedUpload, StorageProvider } from './types';

/** Implementação em memória, apenas para testes. */
export class MemoryStorage implements StorageProvider {
  readonly name = 'memory';
  readonly verifiesChecksumOnUpload = true;
  readonly objects = new Map<string, Uint8Array>();

  async createUploadUrl(input: { key: string; contentType: string }): Promise<SignedUpload> {
    return {
      url: `https://storage.test/${input.key}?signed=1`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
    };
  }
  async createDownloadUrl(key: string): Promise<string> {
    return `https://storage.test/${key}?signed=get`;
  }
  async head(key: string) {
    const obj = this.objects.get(key);
    return obj ? { size: obj.length } : null;
  }
  async readRange(key: string, offset: number, length: number) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error('object not found');
    return obj.slice(offset, offset + length);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  /** Simula o PUT do cliente. */
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
}
