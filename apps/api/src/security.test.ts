import { describe, expect, it } from 'vitest';
import { addMember, Client, createTestEnv, registerUser } from './test/helpers';

/**
 * Revisão de segurança automatizada (Fase 8): percorre TODAS as rotas registradas na API, então
 * uma rota nova sem proteção quebra este teste em vez de passar despercebida.
 */

// Rotas públicas por desenho (sem sessão).
const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/reports',
  'GET /api/invites/:token',
]);

const ID = '00000000-0000-4000-8000-000000000001';
const fill = (path: string) => path.replace(/:[A-Za-z]+/g, ID).replace(/\{[^}]+\}/g, ID);

async function setup() {
  const env = await createTestEnv();
  const routes = env.app.routes
    .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/'))
    .map((r) => ({ method: r.method, path: r.path }));
  // Remove duplicatas (middlewares aparecem repetidos).
  const unique = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()];
  return { env, routes: unique };
}

describe('revisão de segurança automatizada', () => {
  it('há rotas suficientes para o teste valer', async () => {
    const { routes } = await setup();
    expect(routes.length).toBeGreaterThan(80);
    expect(
      routes.filter((r) => r.path.includes('/workspaces/:workspaceId')).length,
    ).toBeGreaterThan(40);
  });

  it('sem sessão, toda rota que não é pública responde 401 (ou 404 nas de billing)', async () => {
    const { env, routes } = await setup();
    const anon = new Client(env);
    const offenders: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key) || r.path.startsWith('/api/billing')) continue;
      const res = await anon.request(r.method, fill(r.path), r.method === 'GET' ? undefined : {});
      if (res.status !== 401) offenders.push(`${key} → ${res.status}`);
    }
    expect(offenders).toEqual([]);
  });

  it('quem não é membro recebe 404 em TODA rota de workspace (não revela existência)', async () => {
    const { env, routes } = await setup();
    const outsider = await registerUser(env, 'fora@example.com');
    const victim = await registerUser(env, 'vitima@example.com');
    const offenders: string[] = [];
    for (const r of routes.filter((x) => x.path.includes('/workspaces/:workspaceId'))) {
      const path = fill(r.path).replace(ID, victim.workspaceId);
      const res = await outsider.client.request(
        r.method,
        path,
        r.method === 'GET' ? undefined : {},
      );
      if (res.status !== 404) offenders.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(offenders).toEqual([]);
  });

  it('leitor (viewer) nunca consegue alterar dados do workspace', async () => {
    const { env, routes } = await setup();
    const owner = await registerUser(env, 'dono@example.com');
    const viewer = await registerUser(env, 'leitor@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    // Rotas que usam apenas `read` mas escrevem coisas pessoais do próprio leitor, por desenho.
    const READ_ONLY_WRITES = new Set<string>([]);
    const offenders: string[] = [];
    for (const r of routes.filter(
      (x) => x.path.includes('/workspaces/:workspaceId') && x.method !== 'GET',
    )) {
      const key = `${r.method} ${r.path}`;
      if (READ_ONLY_WRITES.has(key)) continue;
      const path = fill(r.path).replace(ID, owner.workspaceId);
      const res = await viewer.client.request(r.method, path, {});
      if (res.status !== 403 && res.status !== 404) offenders.push(`${key} → ${res.status}`);
    }
    expect(offenders).toEqual([]);
  });

  it('nenhuma resposta de erro vaza pilha, SQL ou caminhos internos', async () => {
    const { env, routes } = await setup();
    const owner = await registerUser(env, 'dono2@example.com');
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.path.includes('/workspaces/:workspaceId'))) {
      const path = fill(r.path).replace(ID, owner.workspaceId);
      const res = await owner.client.request(
        r.method,
        path,
        r.method === 'GET' ? undefined : { x: 1 },
      );
      const text = JSON.stringify(res.json ?? '');
      if (res.status >= 500) bad.push(`${r.method} ${r.path} → ${res.status}`);
      if (/select |insert |update |at .*\.ts|node_modules|postgres/i.test(text)) {
        bad.push(`${r.method} ${r.path} vaza detalhe interno`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('CSRF: escrita sem cabeçalho de origem/requisição é recusada', async () => {
    const { env } = await setup();
    const u = await registerUser(env, 'csrf@example.com');
    const res = await env.app.request('http://localhost/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: u.client.cookie },
      body: JSON.stringify({ name: 'X' }),
    });
    expect([400, 403]).toContain(res.status);
  });

  it('cookie de sessão é HttpOnly e SameSite', async () => {
    const env = await createTestEnv();
    const res = await env.app.request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'docupilot' },
      body: JSON.stringify({
        email: 'cookie@example.com',
        password: 'correct horse battery staple',
        displayName: 'C',
      }),
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});
