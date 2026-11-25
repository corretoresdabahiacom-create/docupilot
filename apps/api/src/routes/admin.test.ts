import { beforeEach, describe, expect, it } from 'vitest';
import { REPORT_GRACE_HOURS } from '@docupilot/shared';
import { runRetention } from '../retention';
import {
  Client,
  createTestEnv,
  eq,
  pdfBytes,
  registerUser,
  schema,
  type TestEnv,
} from '../test/helpers';

type U = Awaited<ReturnType<typeof registerUser>>;
let env: TestEnv;
let admin: U;
let owner: U;
let counter = 0;

beforeEach(async () => {
  env = await createTestEnv();
  admin = await registerUser(env, 'admin@example.com', 'Admin');
  await env.db
    .update(schema.users)
    .set({ isPlatformAdmin: true })
    .where(eq(schema.users.id, admin.userId));
  owner = await registerUser(env, 'dono@example.com', 'Dono');
  counter = 0;
});

async function newDoc(secretName = 'segredo-cpf-123.pdf') {
  const sha256 = (++counter).toString(16).padStart(64, '0');
  const bytes = pdfBytes(300);
  const ws = `/api/workspaces/${owner.workspaceId}`;
  const created = await owner.client.post(`${ws}/uploads`, {
    fileName: secretName,
    mime: 'application/pdf',
    size: bytes.length,
    sha256,
  });
  env.storage!.put(`ws/${owner.workspaceId}/${created.json.uploadId}`, bytes);
  const done = await owner.client.post(`${ws}/uploads/${created.json.uploadId}/complete`);
  expect(done.status).toBe(201);
  const id = done.json.document.id as string;
  const base = `${ws}/documents/${id}/versions/${done.json.versionId}`;
  await owner.client.request('PUT', `${base}/pages`, {
    pages: [{ pageNumber: 1, text: 'TEXTO-CONFIDENCIAL-DO-CONTRATO' }],
    extractedBy: 'client',
  });
  await owner.client.post(`${base}/extraction/complete`, {
    status: 'extracted',
    pageCount: 1,
    extractedBy: 'client',
  });
  return id;
}

const report = (c: Client, over: Record<string, unknown> = {}) =>
  c.post('/api/reports', {
    targetType: 'document',
    targetRef: 'x',
    reason: 'Conteúdo indevido compartilhado',
    ...over,
  });

describe('acesso ao painel', () => {
  it('quem não é admin recebe 404 em todas as rotas; anônimo recebe 401', async () => {
    const paths = [
      '/overview',
      '/users',
      '/organizations',
      '/workspaces',
      '/documents',
      '/jobs',
      '/failures',
      '/shares',
      '/reports',
      '/flags',
      '/quotas',
    ];
    const anon = new Client(env);
    for (const p of paths) {
      expect((await owner.client.get(`/api/admin${p}`)).status, p).toBe(404);
      expect((await anon.get(`/api/admin${p}`)).status, p).toBe(401);
    }
    expect((await owner.client.post('/api/admin/maintenance/retention')).status).toBe(404);
  });
});

describe('somente metadados', () => {
  it('nenhuma rota do painel devolve conteúdo, texto extraído ou nome de arquivo', async () => {
    await newDoc('segredo-cpf-123.pdf');
    for (const p of ['/overview', '/documents', '/workspaces', '/jobs', '/failures', '/users']) {
      const res = await admin.client.get(`/api/admin${p}`);
      expect(res.status, p).toBe(200);
      const body = JSON.stringify(res.json);
      expect(body, p).not.toContain('TEXTO-CONFIDENCIAL');
      expect(body, p).not.toContain('segredo-cpf');
    }
    const docs = await admin.client.get('/api/admin/documents');
    expect(docs.json.documents).toHaveLength(1);
    expect(Object.keys(docs.json.documents[0]).sort()).toEqual(
      ['createdAt', 'id', 'mime', 'pageCount', 'sizeBytes', 'status', 'workspaceId'].sort(),
    );
  });

  it('visão geral: contagens e honestidade sobre o que não é medido', async () => {
    await newDoc();
    const res = await admin.client.get('/api/admin/overview');
    expect(res.json.totals).toMatchObject({ activeUsers: 2, documents: 1 });
    expect(res.json.totals.documentsByStatus.extracted).toBe(1);
    expect(res.json.consumption.storageBytes).toBeGreaterThan(0);
    expect(res.json.consumption.workers).toEqual({ measured: false });
    expect(res.json.consumption.objectStorage.measured).toBe(false);
    expect(res.json.consumption.database.nominalVerified).toBe(false);
    expect(res.json.shares.featureImplemented).toBe(false);
  });
});

describe('usuários', () => {
  it('suspende e reativa; suspenso perde a sessão e não entra; admin é protegido', async () => {
    const sus = await admin.client.request('PATCH', `/api/admin/users/${owner.userId}`, {
      status: 'suspended',
    });
    expect(sus.status).toBe(200);
    expect((await owner.client.get('/api/auth/me')).status).toBe(401);
    const back = await admin.client.request('PATCH', `/api/admin/users/${owner.userId}`, {
      status: 'active',
    });
    expect(back.status).toBe(200);
    const login = await new Client(env).post('/api/auth/login', {
      email: 'dono@example.com',
      password: 'correct horse battery staple',
    });
    expect(login.status).toBe(200);
    expect(
      (
        await admin.client.request('PATCH', `/api/admin/users/${admin.userId}`, {
          status: 'suspended',
        })
      ).status,
    ).toBe(403);
  });

  it('busca por e-mail sem tratar % como curinga', async () => {
    const all = await admin.client.get('/api/admin/users?q=%25');
    expect(all.json.users).toHaveLength(0);
    const one = await admin.client.get('/api/admin/users?q=dono');
    expect(one.json.users).toHaveLength(1);
  });
});

describe('denúncias', () => {
  it('é pública, limitada por hora e valida o corpo', async () => {
    const anon = new Client(env);
    expect((await report(anon)).status).toBe(201);
    expect((await report(anon, { reason: 'curto' })).status).toBe(400);
    expect((await report(anon, { targetType: 'banana' })).status).toBe(400);
    for (let i = 0; i < 4; i++) expect((await report(anon)).status).toBe(201);
    expect((await report(anon)).status).toBe(429);
    const list = await admin.client.get('/api/admin/reports');
    expect(list.json.reports).toHaveLength(5);
    expect(list.json.graceHours).toBe(REPORT_GRACE_HOURS);
  });

  it('não revela se o conteúdo denunciado existe', async () => {
    const id = await newDoc();
    const a = await report(new Client(env), { targetRef: id });
    const b = await report(new Client(env), { targetRef: 'inexistente' });
    expect(a.status).toBe(b.status);
    expect(a.json).toEqual(b.json);
  });

  it('remoção sem urgência exige aviso ao dono e o fim do prazo', async () => {
    const id = await newDoc();
    await report(new Client(env), { targetRef: id });
    const rep = (await admin.client.get('/api/admin/reports')).json.reports[0];

    // sem aviso: recusa
    const early = await admin.client.post(`/api/admin/reports/${rep.id}/remove`, {});
    expect(early.status).toBe(409);

    // avisa: o dono recebe notificação dentro do app
    const notify = await admin.client.post(`/api/admin/reports/${rep.id}/notify-owner`);
    expect(notify.status).toBe(200);
    expect(notify.json.notified).toBe(1);
    const notes = await owner.client.get('/api/me/notifications');
    expect(notes.json.notifications.some((n: any) => n.kind === 'report_notice')).toBe(true);

    // dentro do prazo: recusa e o documento continua lá
    expect((await admin.client.post(`/api/admin/reports/${rep.id}/remove`, {})).status).toBe(409);
    expect(
      (await owner.client.get(`/api/workspaces/${owner.workspaceId}/documents/${id}`)).status,
    ).toBe(200);

    // passado o prazo: remove
    await env.db
      .update(schema.reports)
      .set({ removalAfter: Date.now() - 1000 })
      .where(eq(schema.reports.id, rep.id));
    const rm = await admin.client.post(`/api/admin/reports/${rep.id}/remove`, {});
    expect(rm.status).toBe(200);
    expect(
      (await owner.client.get(`/api/workspaces/${owner.workspaceId}/documents/${id}`)).status,
    ).toBe(404);
    const done = (await admin.client.get('/api/admin/reports?status=removed')).json.reports[0];
    expect(done).toMatchObject({ resolution: 'removed', resolvedBy: admin.userId });
    // contadores do workspace voltam a zero
    const ws = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0];
    expect(ws).toMatchObject({ documentCount: 0, storageBytesUsed: 0 });
    // já resolvida: não repete
    expect((await admin.client.post(`/api/admin/reports/${rep.id}/remove`, {})).status).toBe(409);
  });

  it('remoção urgente: motivo obrigatório, auditada, dono avisado depois', async () => {
    const id = await newDoc();
    await report(new Client(env), { targetRef: id });
    const rep = (await admin.client.get('/api/admin/reports')).json.reports[0];
    expect(
      (await admin.client.post(`/api/admin/reports/${rep.id}/remove`, { urgent: true })).status,
    ).toBe(400);
    const rm = await admin.client.post(`/api/admin/reports/${rep.id}/remove`, {
      urgent: true,
      urgentReason: 'Conteúdo ilegal comprovado',
    });
    expect(rm.status).toBe(200);
    expect(
      (await owner.client.get(`/api/workspaces/${owner.workspaceId}/documents/${id}`)).status,
    ).toBe(404);
    const after = (await admin.client.get('/api/admin/reports?status=removed')).json.reports[0];
    expect(after.resolution).toBe('removed_urgent');
    const notes = await owner.client.get('/api/me/notifications');
    expect(notes.json.notifications.some((n: any) => n.kind === 'report_removed')).toBe(true);
    const audit = await env.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'admin.report_removed_urgent'));
    expect(audit).toHaveLength(1);
  });

  it('dispensar resolve sem tocar no documento; outros tipos não são removíveis', async () => {
    const id = await newDoc();
    await report(new Client(env), { targetRef: id });
    await report(new Client(env), { targetType: 'other', targetRef: 'site externo' });
    const reps = (await admin.client.get('/api/admin/reports')).json.reports;
    const docRep = reps.find((r: any) => r.targetType === 'document');
    const otherRep = reps.find((r: any) => r.targetType === 'other');
    expect((await admin.client.post(`/api/admin/reports/${docRep.id}/dismiss`)).status).toBe(200);
    expect(
      (await owner.client.get(`/api/workspaces/${owner.workspaceId}/documents/${id}`)).status,
    ).toBe(200);
    expect((await admin.client.post(`/api/admin/reports/${otherRep.id}/notify-owner`)).status).toBe(
      409,
    );
    expect(
      (
        await admin.client.post(`/api/admin/reports/${otherRep.id}/remove`, {
          urgent: true,
          urgentReason: 'não se aplica a este tipo',
        })
      ).status,
    ).toBe(409);
  });
});

describe('flags e quotas', () => {
  it('flags podem ser desligadas, nunca ligadas (sem implementação)', async () => {
    const flags = await admin.client.get('/api/admin/flags');
    expect(flags.json.flags.every((f: any) => f.enabled === false)).toBe(true);
    expect(
      (
        await admin.client.request('PUT', '/api/admin/flags/monetization_enabled', {
          enabled: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin.client.request('PUT', '/api/admin/flags/monetization_enabled', {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await admin.client.request('PUT', '/api/admin/flags/nao_existe', { enabled: false })).status,
    ).toBe(404);
    // /billing continua 404
    expect((await admin.client.get('/api/billing/checkout')).status).toBe(404);
  });

  it('altera e restaura uma quota; vale para o app', async () => {
    const set = await admin.client.request('PUT', '/api/admin/quotas/documentsPerWorkspace', {
      value: 1,
    });
    expect(set.status).toBe(200);
    const q = await admin.client.get('/api/admin/quotas');
    expect(q.json.overrides.documentsPerWorkspace).toBe(1);
    expect(q.json.effective.documentsPerWorkspace).toBe(1);
    await newDoc();
    const sha256 = 'e'.repeat(64);
    const second = await owner.client.post(`/api/workspaces/${owner.workspaceId}/uploads`, {
      fileName: 'b.pdf',
      mime: 'application/pdf',
      size: 300,
      sha256,
    });
    expect(second.status).toBe(429);
    await admin.client.request('DELETE', '/api/admin/quotas/documentsPerWorkspace');
    expect((await admin.client.get('/api/admin/quotas')).json.effective.documentsPerWorkspace).toBe(
      200,
    );
    expect(
      (await admin.client.request('PUT', '/api/admin/quotas/inventada', { value: 1 })).status,
    ).toBe(404);
    expect(
      (await admin.client.request('PUT', '/api/admin/quotas/maxFileBytes', { value: -1 })).status,
    ).toBe(400);
  });
});

describe('jobs travados e retenção', () => {
  it('lista execução parada e extração esquecida, sem conteúdo', async () => {
    const wf = await owner.client.get(`/api/workspaces/${owner.workspaceId}/workflows`);
    expect(wf.status).toBe(200);
    const [def] = await env.db
      .insert(schema.workflowDefinitions)
      .values({ workspaceId: owner.workspaceId, name: 'segredo-fluxo', createdBy: owner.userId })
      .returning();
    await env.db.insert(schema.workflowExecutions).values({
      workflowId: def!.id,
      status: 'running',
      startedAt: Date.now() - 3_600_000,
    });
    const jobs = await admin.client.get('/api/admin/jobs');
    expect(jobs.json.executions).toHaveLength(1);
    expect(JSON.stringify(jobs.json)).not.toContain('segredo-fluxo');
    expect((await admin.client.get('/api/admin/overview')).json.jobs.stuckExecutions).toBe(1);
  });

  it('retenção apaga só o que passou do prazo', async () => {
    const DAY = 86_400_000;
    const now = Date.now();
    await env.db.insert(schema.auditLogs).values([
      { action: 'velho', createdAt: now - 181 * DAY },
      { action: 'novo', createdAt: now - 10 * DAY },
    ]);
    await env.db.insert(schema.reports).values([
      {
        targetType: 'other',
        targetRef: 'a',
        reason: 'resolvida há muito tempo',
        status: 'dismissed',
        resolvedAt: now - 181 * DAY,
      },
      {
        targetType: 'other',
        targetRef: 'b',
        reason: 'resolvida recentemente',
        status: 'dismissed',
        resolvedAt: now - 5 * DAY,
      },
      {
        targetType: 'other',
        targetRef: 'c',
        reason: 'ainda aberta e antiga',
        status: 'open',
        createdAt: now - 400 * DAY,
      },
    ]);
    const res = await admin.client.post('/api/admin/maintenance/retention');
    expect(res.status).toBe(200);
    expect(res.json.result.auditLogs).toBe(1);
    expect(res.json.result.reports).toBe(1);
    const left = await env.db.select().from(schema.reports);
    expect(left.map((r) => r.targetRef).sort()).toEqual(['b', 'c']);
    const logs = await env.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'novo'));
    expect(logs).toHaveLength(1);
    // idempotente
    const again = await runRetention(env.db);
    expect(again.auditLogs).toBe(0);
    expect(again.reports).toBe(0);
  });
});
