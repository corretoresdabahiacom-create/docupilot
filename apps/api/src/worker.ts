import { drizzle } from 'drizzle-orm/d1';
import { MAX_ITERATIONS } from './auth/password';
import { createApp } from './app';
import * as schema from './db/schema';
import { createStorage } from './storage';
import type { AppConfig, Env } from './types';

function buildConfig(env: Env): AppConfig {
  const iterations = Number(env.PBKDF2_ITERATIONS ?? MAX_ITERATIONS);
  return {
    environment: env.ENVIRONMENT === 'development' ? 'development' : 'production',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnstileSecret: env.TURNSTILE_SECRET,
    pbkdf2Iterations: Number.isFinite(iterations) && iterations > 0 ? iterations : MAX_ITERATIONS,
  };
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp({
      db: drizzle(env.DB, { schema }),
      storage: createStorage(env),
      config: buildConfig(env),
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
