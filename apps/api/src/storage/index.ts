import type { Env } from '../types';
import { R2Storage } from './r2';
import type { StorageProvider } from './types';

/** Retorna null quando o armazenamento não está configurado (a UI mostra o estado real). */
export function createStorage(env: Env): StorageProvider | null {
  const { STORAGE_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } =
    env;
  if (
    !STORAGE_BUCKET ||
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_NAME
  ) {
    return null;
  }
  return new R2Storage({
    bucket: STORAGE_BUCKET,
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucketName: R2_BUCKET_NAME,
  });
}
