import { and, eq, gt } from 'drizzle-orm';
import { SESSION_TTL_DAYS } from '@docupilot/shared';
import { sessions, userProfiles, users } from '../db/schema';
import type { AuthUser, Db } from '../types';
import { randomToken, sha256Hex } from './crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ROTATE_AFTER_MS = DAY_MS;

export function cookieName(environment: string): string {
  // O prefixo __Host- exige Secure; em desenvolvimento (http) usa nome simples.
  return environment === 'production' ? '__Host-dp_session' : 'dp_session';
}

export async function newSessionValues(
  userId: string,
  now: number,
  userAgent: string | null,
): Promise<{ token: string; row: typeof sessions.$inferInsert }> {
  const token = randomToken(32);
  return {
    token,
    row: {
      id: crypto.randomUUID(),
      userId,
      tokenHash: await sha256Hex(token),
      createdAt: now,
      rotatedAt: now,
      expiresAt: now + SESSION_TTL_DAYS * DAY_MS,
      userAgent,
    },
  };
}

export interface ResolvedSession {
  user: AuthUser;
  sessionId: string;
  /** Presente quando o token foi rotacionado: o cookie precisa ser reescrito. */
  rotatedToken?: string;
}

export async function resolveSession(
  db: Db,
  token: string,
  now: number,
): Promise<ResolvedSession | null> {
  const tokenHash = await sha256Hex(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      rotatedAt: sessions.rotatedAt,
      userId: users.id,
      email: users.email,
      status: users.status,
      isPlatformAdmin: users.isPlatformAdmin,
      displayName: userProfiles.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== 'active') return null;

  const user: AuthUser = {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    isPlatformAdmin: row.isPlatformAdmin,
  };

  if (now - row.rotatedAt < ROTATE_AFTER_MS) return { user, sessionId: row.sessionId };

  // Rotação: no máximo uma escrita por sessão por dia.
  const fresh = randomToken(32);
  await db
    .update(sessions)
    .set({
      tokenHash: await sha256Hex(fresh),
      rotatedAt: now,
      expiresAt: now + SESSION_TTL_DAYS * DAY_MS,
    })
    .where(eq(sessions.id, row.sessionId));
  return { user, sessionId: row.sessionId, rotatedToken: fresh };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
}
