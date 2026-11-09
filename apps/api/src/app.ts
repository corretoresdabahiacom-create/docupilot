import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { AppError } from './errors';
import { csrfOrigin } from './middleware/origin';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/uploads';
import { workspaceRoutes } from './routes/workspaces';
import type { AppDeps, AppVariables } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AppVariables }>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', secureHeaders());
  app.use('*', csrfOrigin);

  // Monetização desligada (R7): qualquer rota de cobrança responde 404.
  app.all('/billing/*', (c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } }, 404),
  );

  app.route('/', healthRoutes);
  app.route('/auth', authRoutes);
  app.route('/workspaces', workspaceRoutes);
  app.route('/workspaces', uploadRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } }, 404),
  );
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    // Não registra corpo nem cabeçalhos: apenas o tipo do erro.
    console.error('unhandled', err instanceof Error ? err.name : 'unknown');
    return c.json({ error: { code: 'INTERNAL', message: 'Erro interno.' } }, 500);
  });
  return app;
}
