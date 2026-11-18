/** Notificações in-app (Fase 6). Sem Web Push nem e-mail (dependem de serviços externos). */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { notifications } from '../db/schema';
import { parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import type { AppVariables } from '../types';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const notificationRoutes = new Hono<{ Variables: AppVariables }>();
notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', async (c) => {
  const { db } = c.get('deps');
  const userId = c.get('user').id;
  const [rows, unread] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return c.json({
    notifications: rows.map((r) => {
      return {
        id: r.id,
        kind: r.kind,
        data: parseJson(r.body),
        readAt: r.readAt,
        createdAt: r.createdAt,
      };
    }),
    unread: Number(unread[0]?.n ?? 0),
  });
});

const readSchema = z.strictObject({ ids: z.array(z.string().max(64)).max(100).optional() });

/** Marca como lidas as indicadas (ou todas, se `ids` não vier). Só as do próprio usuário. */
notificationRoutes.post('/read', async (c) => {
  const { db } = c.get('deps');
  const userId = c.get('user').id;
  const { ids } = await parseBody(c, readSchema);
  const mine = ids
    ? and(
        eq(notifications.userId, userId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      )
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: Date.now() }).where(mine);
  return c.json({ ok: true });
});
