import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Permission, Role } from '@docupilot/shared';
import type { FolderAccess } from './access';
import type * as schema from './db/schema';
import type { StorageProvider } from './storage/types';

export type Db = PgDatabase<any, typeof schema>;

/** Bindings e segredos do Worker. Tudo opcional é "não configurado" (R4). */
export interface Env {
  /** Connection string do Postgres (Supabase, pooler porta 6543). Segredo: `wrangler secret put DATABASE_URL`. */
  DATABASE_URL?: string;
  STORAGE_BUCKET?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  SUPABASE_S3_ENDPOINT?: string;
  SUPABASE_S3_REGION?: string;
  SUPABASE_S3_ACCESS_KEY_ID?: string;
  SUPABASE_S3_SECRET_ACCESS_KEY?: string;
  SUPABASE_S3_BUCKET?: string;
  TURNSTILE_SECRET?: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  PBKDF2_ITERATIONS?: string;
  PII_ENCRYPTION_KEY?: string;
}

/** Configuração efetiva usada pelo app (separada de Env para facilitar testes). */
export interface AppConfig {
  environment: 'development' | 'production' | 'test';
  allowedOrigins: string[];
  turnstileSecret?: string;
  /** Chave AES-GCM (base64, 32 bytes) dos perfis de dados pessoais. Ausente = recurso desligado. */
  piiKey?: string;
  /** Só testes: reduz os limites do motor de workflow (timeout/retry). */
  workflowLimits?: { stepTimeoutMs?: number; totalTimeoutMs?: number; maxRetries?: number };
  /** `false` quando o Worker está sem `DATABASE_URL` (R4). Ausente nos testes = configurado. */
  databaseConfigured?: boolean;
  pbkdf2Iterations: number;
  fetchImpl?: typeof fetch;
}

export interface AppDeps {
  db: Db;
  storage: StorageProvider | null;
  config: AppConfig;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export interface WorkspaceMember {
  workspaceId: string;
  role: Role;
  /** Permissão exigida pela rota (usada na checagem de acesso por pasta). */
  permission?: Permission;
}

export type AppVariables = {
  deps: AppDeps;
  user: AuthUser;
  member: WorkspaceMember;
  folderAccess?: FolderAccess;
};
