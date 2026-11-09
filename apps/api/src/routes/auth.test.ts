import { beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  PASSWORD,
  createTestEnv,
  eq,
  registerUser,
  schema,
  type TestEnv,
} from '../test/helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

describe('cadastro', () => {
  it('cria usuário, organização pessoal, workspace pessoal e sessão', async () => {
    const { client, workspaceId } = await registerUser(env, 'ana@example.com', 'Ana');
    expect(client.cookie).toMatch(/^dp_session=/);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe('ana@example.com');
    expect(me.json.workspaces).toEqual([
      { id: workspaceId, name: 'Pessoal', isPersonal: true, role: 'owner' },
    ]);
    const orgs = await env.db.select().from(schema.organizations);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.kind).toBe('personal');
  });

  it('cookie é HttpOnly e SameSite=Lax', async () => {
    const c = new Client(env);
    const res = await c.post('/api/auth/register', {
      email: 'b@example.com',
      password: PASSWORD,
      displayName: 'B',
    });
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
  });

  it('em produção o cookie usa prefixo __Host- e Secure', async () => {
    const prod = await createTestEnv({
      config: {
        environment: 'production',
        turnstileSecret: 's',
        fetchImpl: (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch,
      },
    });
    const c = new Client(prod);
    const res = await c.post('/api/auth/register', {
      email: 'p@example.com',
      password: PASSWORD,
      displayName: 'P',
      turnstileToken: 't',
    });
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain('__Host-dp_session=');
    expect(set).toContain('Secure');
  });

  it('não armazena a senha nem o token em claro', async () => {
    const { client } = await registerUser(env, 'c@example.com');
    const u = (await env.db.select().from(schema.users))[0]!;
    expect(u.passwordHash).not.toContain(PASSWORD);
    const token = client.cookie.split('=')[1]!;
    const s = (await env.db.select().from(schema.sessions))[0]!;
    expect(s.tokenHash).not.toBe(token);
    expect(s.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita e-mail duplicado e senha curta', async () => {
    await registerUser(env, 'd@example.com');
    const c = new Client(env);
    const dup = await c.post('/api/auth/register', {
      email: 'D@example.com',
      password: PASSWORD,
      displayName: 'D',
    });
    expect(dup.status).toBe(409);
    const weak = await c.post('/api/auth/register', {
      email: 'e@example.com',
      password: 'curta',
      displayName: 'E',
    });
    expect(weak.status).toBe(400);
    expect(weak.json.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(weak.json)).not.toContain('curta');
  });
});

describe('login e sessão', () => {
  it('autentica com credenciais corretas', async () => {
    await registerUser(env, 'f@example.com');
    const c = new Client(env);
    const res = await c.post('/api/auth/login', { email: 'f@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('usa a mesma resposta para senha errada e e-mail inexistente', async () => {
    await registerUser(env, 'g@example.com');
    const c = new Client(env);
    const wrong = await c.post('/api/auth/login', {
      email: 'g@example.com',
      password: 'senha-errada-qualquer',
    });
    const ghost = await c.post('/api/auth/login', {
      email: 'nao@example.com',
      password: 'senha-errada-qualquer',
    });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(wrong.json).toEqual(ghost.json);
  });

  it('bloqueia após 5 falhas e libera o contador no sucesso depois do bloqueio expirar', async () => {
    await registerUser(env, 'h@example.com');
    const c = new Client(env);
    for (let i = 0; i < 5; i++) {
      expect(
        (await c.post('/api/auth/login', { email: 'h@example.com', password: 'errada-errada-1' }))
          .status,
      ).toBe(401);
    }
    const locked = await c.post('/api/auth/login', { email: 'h@example.com', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('RATE_LIMITED');
    await env.db.update(schema.rateLimitCounters).set({ lockedUntil: Date.now() - 1 });
    expect(
      (await c.post('/api/auth/login', { email: 'h@example.com', password: PASSWORD })).status,
    ).toBe(200);
    expect(await env.db.select().from(schema.rateLimitCounters)).toHaveLength(0);
  });

  it('logout invalida a sessão no servidor', async () => {
    const { client } = await registerUser(env, 'i@example.com');
    const old = client.cookie;
    expect((await client.post('/api/auth/logout')).status).toBe(200);
    const replay = new Client(env);
    replay.cookie = old;
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('exige sessão nas rotas protegidas', async () => {
    expect((await new Client(env).get('/api/auth/me')).status).toBe(401);
  });

  it('rejeita sessão expirada', async () => {
    const { client } = await registerUser(env, 'j@example.com');
    await env.db.update(schema.sessions).set({ expiresAt: Date.now() - 1 });
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('rotaciona o token após 24h e o token antigo deixa de valer', async () => {
    const { client } = await registerUser(env, 'k@example.com');
    const before = client.cookie;
    await env.db.update(schema.sessions).set({ rotatedAt: Date.now() - 25 * 60 * 60 * 1000 });
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect(client.cookie).not.toBe(before);
    const stale = new Client(env);
    stale.cookie = before;
    expect((await stale.get('/api/auth/me')).status).toBe(401);
  });

  it('não permite login de usuário suspenso', async () => {
    await registerUser(env, 'l@example.com');
    await env.db
      .update(schema.users)
      .set({ status: 'suspended' })
      .where(eq(schema.users.email, 'l@example.com'));
    const res = await new Client(env).post('/api/auth/login', {
      email: 'l@example.com',
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});

describe('proteção CSRF por origem', () => {
  it('bloqueia POST sem Origin e sem cabeçalho de cliente', async () => {
    const res = await env.app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
    });
    expect(res.status).toBe(403);
  });
  it('bloqueia Origin não permitido e aceita o permitido', async () => {
    const c = new Client(env);
    const body = { email: 'm@example.com', password: PASSWORD, displayName: 'M' };
    expect((await c.post('/api/auth/register', body, { origin: 'https://evil.test' })).status).toBe(
      403,
    );
    expect((await c.post('/api/auth/register', body, { origin: 'https://app.test' })).status).toBe(
      201,
    );
  });
});

describe('Turnstile', () => {
  it('em produção sem segredo recusa com SERVICE_NOT_CONFIGURED', async () => {
    const prod = await createTestEnv({ config: { environment: 'production' } });
    const res = await new Client(prod).post('/api/auth/register', {
      email: 'n@example.com',
      password: PASSWORD,
      displayName: 'N',
    });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('SERVICE_NOT_CONFIGURED');
  });
  it('com segredo, exige token e respeita o resultado da verificação', async () => {
    const ok = await createTestEnv({
      config: {
        turnstileSecret: 's',
        fetchImpl: (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch,
      },
    });
    const bad = await createTestEnv({
      config: {
        turnstileSecret: 's',
        fetchImpl: (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch,
      },
    });
    const body = { email: 'o@example.com', password: PASSWORD, displayName: 'O' };
    expect((await new Client(ok).post('/api/auth/register', body)).status).toBe(400);
    expect(
      (await new Client(ok).post('/api/auth/register', { ...body, turnstileToken: 't' })).status,
    ).toBe(201);
    expect(
      (await new Client(bad).post('/api/auth/register', { ...body, turnstileToken: 't' })).status,
    ).toBe(400);
  });
});

describe('monetização desligada', () => {
  it('rotas /billing/* respondem 404 e a flag está desligada', async () => {
    const c = new Client(env);
    expect((await c.get('/api/billing/checkout')).status).toBe(404);
    expect((await c.post('/api/billing/subscribe', {})).status).toBe(404);
    const health = await c.get('/api/health');
    expect(health.json.flags.monetization_enabled).toBe(false);
    expect(health.json.storage.configured).toBe(true);
  });
  it('health informa armazenamento não configurado', async () => {
    const none = await createTestEnv({ storage: false });
    expect((await new Client(none).get('/api/health')).json.storage).toEqual({
      configured: false,
      provider: null,
    });
  });
});
