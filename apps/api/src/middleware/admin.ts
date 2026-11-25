import type { MiddlewareHandler } from 'hono';
import { notFound } from '../errors';
import type { AppVariables } from '../types';
import { requireAuth } from './auth';

/**
 * Administração da plataforma: só `users.is_platform_admin`. Quem não é admin recebe 404, como se
 * a área não existisse. Não há rota para virar admin: o primeiro é marcado direto no banco.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  await requireAuth(c, async () => undefined);
  if (!c.get('user').isPlatformAdmin) throw notFound();
  return next();
};
