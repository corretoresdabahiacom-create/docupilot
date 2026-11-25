import { and, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { reportCreateSchema } from '@docupilot/shared';
import { sha256Hex } from '../auth/crypto';
import { verifyTurnstile } from '../auth/turnstile';
import { rateLimitCounters, reports } from '../db/schema';
import { AppError } from '../errors';
import { clientIp, parseBody } from '../http';
import type { AppVariables } from '../types';

export const reportRoutes = new Hono<{ Variables: AppVariables }>();

const WINDOW_MS = 3_600_000;
const MAX_PER_WINDOW = 5;

/** Denúncia pública (sem login). Turnstile + limite por hora do IP (só o hash é guardado). */
reportRoutes.post('/', async (c) => {
  const { db, config } = c.get('deps');
  const input = await parseBody(c, reportCreateSchema);
  const ip = clientIp(c);
  await verifyTurnstile(config, input.turnstileToken, ip);

  const now = Date.now();
  const key = `report:${await sha256Hex(ip ?? 'unknown')}`;
  const row = (
    await db
      .select()
      .from(rateLimitCounters)
      .where(
        and(eq(rateLimitCounters.key, key), gt(rateLimitCounters.windowStart, now - WINDOW_MS)),
      )
      .limit(1)
  )[0];
  if (row && row.count >= MAX_PER_WINDOW) {
    throw new AppError('RATE_LIMITED', 429, 'Muitas denúncias. Tente novamente mais tarde.');
  }
  if (row) {
    await db
      .update(rateLimitCounters)
      .set({ count: row.count + 1 })
      .where(eq(rateLimitCounters.key, key));
  } else {
    await db
      .insert(rateLimitCounters)
      .values({ key, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: rateLimitCounters.key,
        set: { count: 1, windowStart: now, lockedUntil: null },
      });
  }

  // Sempre 201: não revela se o conteúdo denunciado existe.
  await db.insert(reports).values({
    targetType: input.targetType,
    targetRef: input.targetRef,
    reason: input.reason,
  });
  return c.json({ ok: true }, 201);
});
