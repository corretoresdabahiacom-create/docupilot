import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { MAX_ITERATIONS } from './auth/password';
import { createApp } from './app';
import * as schema from './db/schema';
import { runRetention } from './retention';
import { createStorage } from './storage';
import type { AppConfig, AppDeps, Env } from './types';

function buildConfig(env: Env): AppConfig {
  const iterations = Number(env.PBKDF2_ITERATIONS ?? MAX_ITERATIONS);
  return {
    environment: env.ENVIRONMENT === 'development' ? 'development' : 'production',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnstileSecret: env.TURNSTILE_SECRET,
    piiKey: env.PII_ENCRYPTION_KEY,
    databaseConfigured: Boolean(env.DATABASE_URL),
    pbkdf2Iterations: Number.isFinite(iterations) && iterations > 0 ? iterations : MAX_ITERATIONS,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = buildConfig(env);
    // Sem DATABASE_URL a API não finge funcionar (R4): `createApp` responde 503 nas rotas que
    // dependem do banco e `/health` informa `database.configured=false`.
    // Uma conexão por requisição: o Worker não reaproveita sockets entre requisições. O pooler do
    // Supabase (modo transação, porta 6543) não aceita prepared statements.
    const client = env.DATABASE_URL
      ? postgres(env.DATABASE_URL, { max: 1, prepare: false, fetch_types: false, idle_timeout: 5 })
      : null;
    const app = createApp({
      db: (client ? drizzle(client, { schema }) : null) as unknown as AppDeps['db'],
      storage: createStorage(env),
      config,
    });
    try {
      return await app.fetch(request, env, ctx);
    } finally {
      if (client) ctx.waitUntil(client.end({ timeout: 2 }));
    }
  },
  /** Rotina diária de retenção (cron do wrangler.toml): auditoria, sessões, links, denúncias. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DATABASE_URL) return;
    const client = postgres(env.DATABASE_URL, {
      max: 1,
      prepare: false,
      fetch_types: false,
      idle_timeout: 5,
    });
    try {
      await runRetention(drizzle(client, { schema }) as unknown as AppDeps['db']);
    } finally {
      ctx.waitUntil(client.end({ timeout: 2 }));
    }
  },
} satisfies ExportedHandler<Env>;
