import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { Role } from '@docupilot/shared';
import type * as schema from './db/schema';
import type { StorageProvider } from './storage/types';

export type Db = BaseSQLiteDatabase<'async', any, typeof schema>;

/** Bindings e segredos do Worker. Tudo opcional é "não configurado" (R4). */
export interface Env {
  DB: D1Database;
  STORAGE_BUCKET?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
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
}

export type AppVariables = {
  deps: AppDeps;
  user: AuthUser;
  member: WorkspaceMember;
};
