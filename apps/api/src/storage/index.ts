import type { Env } from '../types';
import { R2Storage } from './r2';
import { SupabaseStorage } from './supabase';
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
    return createSupabaseStorage(env);
  }
  return new R2Storage({
    bucket: STORAGE_BUCKET,
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucketName: R2_BUCKET_NAME,
  });
}

/** Plano B (sem cartão): Supabase Storage pela API S3. Só liga com todas as variáveis e HTTPS. */
function createSupabaseStorage(env: Env): StorageProvider | null {
  const endpoint = env.SUPABASE_S3_ENDPOINT;
  const region = env.SUPABASE_S3_REGION;
  const accessKeyId = env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.SUPABASE_S3_SECRET_ACCESS_KEY;
  const bucket = env.SUPABASE_S3_BUCKET;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (!endpoint.startsWith('https://')) return null;
  return new SupabaseStorage({ endpoint, region, accessKeyId, secretAccessKey, bucket });
}
