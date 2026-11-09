import type { MiddlewareHandler } from 'hono';
import { AppError } from '../errors';
import type { AppVariables } from '../types';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Proteção CSRF além de SameSite=Lax: requisições que alteram estado precisam vir de uma origem
 * permitida; sem cabeçalho Origin (clientes não-navegador), exige X-Requested-With.
 */
export const csrfOrigin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const { allowedOrigins } = c.get('deps').config;
  const origin = c.req.header('origin');
  if (origin) {
    const sameOrigin = origin === new URL(c.req.url).origin;
    if (!sameOrigin && !allowedOrigins.includes(origin)) {
      throw new AppError('FORBIDDEN', 403, 'Origem não permitida.');
    }
  } else if (c.req.header('x-requested-with') !== 'docupilot') {
    throw new AppError('FORBIDDEN', 403, 'Origem não permitida.');
  }
  return next();
};
