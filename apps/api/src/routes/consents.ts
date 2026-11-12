import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { consentSchema, CONSENT_PURPOSES } from '@docupilot/shared';
import { runBatch } from '../db/batch';
import { userConsents } from '../db/schema';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import type { AppVariables, Db } from '../types';

export const consentRoutes = new Hono<{ Variables: AppVariables }>();
consentRoutes.use('*', requireAuth);

const PROVIDERS: Record<string, string> = {
  browser_ocr: 'tesseract.js (navegador)',
  pii_profile: 'DocuPilot (D1, criptografado)',
};

export async function hasActiveConsent(db: Db, userId: string, purpose: string): Promise<boolean> {
  const rows = await db
    .select({ id: userConsents.id })
    .from(userConsents)
    .where(
      and(
        eq(userConsents.userId, userId),
        eq(userConsents.purpose, purpose),
        isNull(userConsents.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

consentRoutes.get('/', async (c) => {
  const rows = await c
    .get('deps')
    .db.select({ purpose: userConsents.purpose, grantedAt: userConsents.grantedAt })
    .from(userConsents)
    .where(and(eq(userConsents.userId, c.get('user').id), isNull(userConsents.revokedAt)));
  return c.json({ consents: rows });
});

consentRoutes.post('/', async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  const { purpose } = await parseBody(c, consentSchema);
  if (await hasActiveConsent(db, user.id, purpose)) return c.json({ purpose, granted: true });
  await runBatch(db, [
    db.insert(userConsents).values({
      userId: user.id,
      purpose,
      provider: PROVIDERS[purpose] ?? null,
      grantedAt: Date.now(),
    }),
    auditEntry(db, { userId: user.id, action: 'consent.granted', meta: { purpose } }),
  ]);
  return c.json({ purpose, granted: true }, 201);
});

consentRoutes.delete('/:purpose', async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  const purpose = c.req.param('purpose');
  if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } }, 404);
  }
  await runBatch(db, [
    db
      .update(userConsents)
      .set({ revokedAt: Date.now() })
      .where(
        and(
          eq(userConsents.userId, user.id),
          eq(userConsents.purpose, purpose),
          isNull(userConsents.revokedAt),
        ),
      ),
    auditEntry(db, { userId: user.id, action: 'consent.revoked', meta: { purpose } }),
  ]);
  return c.json({ purpose, granted: false });
});
