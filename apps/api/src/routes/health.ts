import { Hono } from 'hono';
import { featureFlags } from '../db/schema';
import type { AppVariables } from '../types';

export const healthRoutes = new Hono<{ Variables: AppVariables }>();

/** Estado real dos serviços (R4): nada é apresentado como operacional se não estiver configurado. */
healthRoutes.get('/health', async (c) => {
  const { db, storage, config } = c.get('deps');
  const flags = await db.select().from(featureFlags);
  return c.json({
    status: 'ok',
    storage: { configured: storage !== null, provider: storage?.name ?? null },
    turnstile: { configured: Boolean(config.turnstileSecret) },
    flags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
  });
});
