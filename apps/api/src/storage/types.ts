export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Cabeçalhos que o cliente DEVE enviar no PUT (fazem parte da assinatura). */
  headers: Record<string, string>;
}

/** Contrato único de armazenamento (docs/decisions.md D2). */
export interface StorageProvider {
  readonly name: string;
  /** true quando o provedor rejeita o PUT se o SHA-256 não bater com o declarado. */
  readonly verifiesChecksumOnUpload: boolean;
  createUploadUrl(input: {
    key: string;
    contentType: string;
    sha256Hex: string;
    expiresInSeconds: number;
  }): Promise<SignedUpload>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  readRange(key: string, offset: number, length: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Remove vários objetos (R2: até 1.000 chaves por chamada). */
  deleteMany(keys: string[]): Promise<void>;
}
