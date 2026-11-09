import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cookieName, resolveSession } from '../auth/session';
import { unauthenticated } from '../errors';
import type { AppVariables } from '../types';

export function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  environment: string,
  token: string,
): void {
  setCookie(c, cookieName(environment), token, {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(
  c: Parameters<typeof deleteCookie>[0],
  environment: string,
): void {
  deleteCookie(c, cookieName(environment), { path: '/', secure: environment === 'production' });
}

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const { db, config } = c.get('deps');
  const token = getCookie(c, cookieName(config.environment));
  if (!token) throw unauthenticated();
  const session = await resolveSession(db, token, Date.now());
  if (!session) {
    clearSessionCookie(c, config.environment);
    throw unauthenticated();
  }
  if (session.rotatedToken) setSessionCookie(c, config.environment, session.rotatedToken);
  c.set('user', session.user);
  return next();
};
