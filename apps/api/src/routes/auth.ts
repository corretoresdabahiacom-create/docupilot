import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { loginSchema, registerSchema } from '@docupilot/shared';
import { hashPassword, verifyPassword } from '../auth/password';
import { cookieName, destroySession, newSessionValues } from '../auth/session';
import { verifyTurnstile } from '../auth/turnstile';
import {
  rateLimitCounters,
  organizationMembers,
  organizations,
  sessions,
  userProfiles,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { runBatch } from '../db/batch';
import { AppError } from '../errors';
import { auditEntry, clientIp, parseBody } from '../http';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth';
import type { AppVariables, Db } from '../types';

export const authRoutes = new Hono<{ Variables: AppVariables }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

let dummyHash: Promise<string> | undefined;
/** Hash descartável para igualar o tempo de resposta quando o e-mail não existe. */
function getDummyHash(iterations: number): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing', iterations);
  return dummyHash;
}

async function listWorkspaces(db: Db, userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      isPersonal: workspaces.isPersonal,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
}

authRoutes.post('/register', async (c) => {
  const deps = c.get('deps');
  const { db, config } = deps;
  const input = await parseBody(c, registerSchema);
  await verifyTurnstile(config, input.turnstileToken, clientIp(c));

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing.length > 0) throw new AppError('CONFLICT', 409, 'E-mail já cadastrado.');

  const now = Date.now();
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password, config.pbkdf2Iterations);
  const session = await newSessionValues(userId, now, c.req.header('user-agent') ?? null);

  try {
    await runBatch(db, [
      db.insert(users).values({ id: userId, email: input.email, passwordHash }),
      db.insert(userProfiles).values({ userId, displayName: input.displayName }),
      db
        .insert(organizations)
        .values({ id: orgId, name: input.displayName, kind: 'personal', ownerUserId: userId }),
      db.insert(organizationMembers).values({ organizationId: orgId, userId, role: 'owner' }),
      db
        .insert(workspaces)
        .values({ id: workspaceId, organizationId: orgId, name: 'Pessoal', isPersonal: true }),
      db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
      db.insert(sessions).values(session.row),
      auditEntry(db, { userId, workspaceId, action: 'auth.register' }),
    ]);
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) {
      throw new AppError('CONFLICT', 409, 'E-mail já cadastrado.');
    }
    throw err;
  }

  setSessionCookie(c, config.environment, session.token);
  return c.json(
    { user: { id: userId, email: input.email, displayName: input.displayName }, workspaceId },
    201,
  );
});

authRoutes.post('/login', async (c) => {
  const { db, config } = c.get('deps');
  const input = await parseBody(c, loginSchema);
  await verifyTurnstile(config, input.turnstileToken, clientIp(c));

  const now = Date.now();
  const counterKey = `login:${input.email}`;
  const counterRows = await db
    .select()
    .from(rateLimitCounters)
    .where(eq(rateLimitCounters.key, counterKey))
    .limit(1);
  const counter = counterRows[0];
  if (counter?.lockedUntil && counter.lockedUntil > now) {
    throw new AppError('RATE_LIMITED', 429, 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const found = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  const user = found[0];
  const valid = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDummyHash(config.pbkdf2Iterations)),
  );

  if (!user || !valid || user.status !== 'active') {
    const windowFresh = counter && now - counter.windowStart <= WINDOW_MS;
    const count = windowFresh ? counter.count + 1 : 1;
    const lockedUntil = count >= MAX_FAILURES ? now + WINDOW_MS : null;
    if (counter) {
      await db
        .update(rateLimitCounters)
        .set({ count, windowStart: windowFresh ? counter.windowStart : now, lockedUntil })
        .where(eq(rateLimitCounters.key, counterKey));
    } else {
      await db
        .insert(rateLimitCounters)
        .values({ key: counterKey, count, windowStart: now, lockedUntil });
    }
    throw new AppError('UNAUTHENTICATED', 401, 'E-mail ou senha inválidos.');
  }

  const session = await newSessionValues(user.id, now, c.req.header('user-agent') ?? null);
  const queries: unknown[] = [
    db.insert(sessions).values(session.row),
    auditEntry(db, { userId: user.id, action: 'auth.login' }),
  ];
  if (counter)
    queries.push(db.delete(rateLimitCounters).where(eq(rateLimitCounters.key, counterKey)));
  await runBatch(db, queries);

  setSessionCookie(c, config.environment, session.token);
  return c.json({
    user: { id: user.id, email: input.email },
    workspaces: await listWorkspaces(db, user.id),
  });
});

authRoutes.post('/logout', requireAuth, async (c) => {
  const { db, config } = c.get('deps');
  const token = getCookie(c, cookieName(config.environment));
  if (token) await destroySession(db, token);
  await auditEntry(db, { userId: c.get('user').id, action: 'auth.logout' });
  clearSessionCookie(c, config.environment);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    workspaces: await listWorkspaces(c.get('deps').db, user.id),
  });
});
