import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_STEPS } from '@docupilot/shared';
import { addMember, createTestEnv, eq, registerUser, schema, type TestEnv } from '../test/helpers';

let env: TestEnv;
let owner: Awaited<ReturnType<typeof registerUser>>;
const ws = (w = owner.workspaceId) => `/api/workspaces/${w}`;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'o@example.com', 'Owner');
});

/** Semeia um documento já analisado (como a Fase 3 deixa), sem passar pelo upload. */
async function seedDoc(
  workspaceId: string,
  userId: string,
  fields: Array<{ fieldType: string; value: string; label?: string }>,
  opts: { stale?: boolean; analysed?: boolean; inconsistencies?: number } = {},
) {
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await env.db.insert(schema.documents).values({
    id,
    workspaceId,
    name: 'doc.pdf',
    mime: 'application/pdf',
    status: 'extracted',
    currentVersionId: versionId,
    createdBy: userId,
  });
  if (opts.analysed !== false) {
    await env.db.insert(schema.documentTasks).values({
      documentId: id,
      workspaceId,
      kind: 'analysis',
      status: 'done',
      payload: JSON.stringify({ versionId: opts.stale ? 'outra-versao' : versionId }),
    });
  }
  for (let i = 0; i < (opts.inconsistencies ?? 0); i++) {
    await env.db.insert(schema.documentTasks).values({
      documentId: id,
      workspaceId,
      kind: 'inconsistency',
      status: 'open',
      payload: '{}',
    });
  }
  for (const f of fields) {
    await env.db.insert(schema.extractedFields).values({
      documentId: id,
      workspaceId,
      fieldType: f.fieldType,
      rawValue: f.value,
      normalizedValue: f.value,
      label: f.label ?? null,
      patternId: 'test',
      confidence: 1,
      sourceKind: 'deterministic',
    });
  }
  return id;
}

const FULL = [
  { kind: 'input_extract', config: { input: 'primary' } },
  { kind: 'validate', config: { requiredTypes: ['cnpj'], failOnInconsistency: false } },
  {
    kind: 'generate',
    config: {
      templateKey: 'declaracao',
      title: 'Declaração gerada',
      mapping: { declarante: { fieldType: 'cnpj' } },
    },
  },
  { kind: 'approval', config: { note: 'Conferir' } },
  { kind: 'output', config: {} },
];

async function createWorkflow(
  steps: unknown[] = FULL,
  c = owner.client,
  w = owner.workspaceId,
  name = 'Fluxo',
) {
  return c.post(`${ws(w)}/workflows`, { name, steps });
}
const wfId = async (steps?: unknown[]) => {
  const r = await createWorkflow(steps);
  expect(r.status).toBe(201);
  return r.json.id as string;
};
const run = (id: string, body: Record<string, unknown>, c = owner.client, w = owner.workspaceId) =>
  c.post(`${ws(w)}/workflows/${id}/run`, body);
const decide = (
  eid: string,
  body: Record<string, unknown>,
  c = owner.client,
  w = owner.workspaceId,
) => c.post(`${ws(w)}/workflow-executions/${eid}/decision`, body);

describe('definição', () => {
  it('cria, lê, atualiza e exclui', async () => {
    const id = await wfId();
    const got = await owner.client.get(`${ws()}/workflows/${id}`);
    expect(got.json.steps).toHaveLength(5);
    expect(got.json.inputs).toEqual(['primary']);
    const list = await owner.client.get(`${ws()}/workflows`);
    expect(list.json.workflows).toMatchObject([{ id, steps: 5 }]);
    const upd = await owner.client.request('PUT', `${ws()}/workflows/${id}`, {
      name: 'Novo nome',
      steps: [{ kind: 'input_extract', config: { input: 'primary' } }],
    });
    expect(upd.status).toBe(200);
    expect((await owner.client.get(`${ws()}/workflows/${id}`)).json.steps).toHaveLength(1);
    expect((await owner.client.request('DELETE', `${ws()}/workflows/${id}`)).status).toBe(200);
    expect((await owner.client.get(`${ws()}/workflows/${id}`)).status).toBe(404);
  });

  it('rejeita mais de 10 passos, passo desconhecido (sem passo externo) e ordem inválida', async () => {
    const many = Array.from({ length: MAX_STEPS + 1 }, () => ({ kind: 'approval', config: {} }));
    expect((await createWorkflow(many)).status).toBe(400);
    expect((await createWorkflow([{ kind: 'send_email', config: {} }])).status).toBe(400);
    expect(
      (await createWorkflow([{ kind: 'webhook', config: { url: 'https://x.test' } }])).status,
    ).toBe(400);
    // generate sem input_extract antes
    const r = await createWorkflow([
      { kind: 'generate', config: { templateKey: 'carta', title: 'x', mapping: {} } },
    ]);
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/passo 1/);
    // mais de 3 aprovações
    const approvals = Array.from({ length: 4 }, () => ({ kind: 'approval', config: {} }));
    expect((await createWorkflow(approvals)).status).toBe(400);
  });

  it('rejeita mapeamento para campo que o modelo não tem', async () => {
    const r = await createWorkflow([
      { kind: 'input_extract', config: { input: 'primary' } },
      {
        kind: 'generate',
        config: {
          templateKey: 'carta',
          title: 'x',
          mapping: { inexistente: { fieldType: 'cnpj' } },
        },
      },
    ]);
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/inexistente/);
  });

  it('viewer lê mas não cria; outro workspace não enxerga (404)', async () => {
    const id = await wfId();
    const v = await registerUser(env, 'v@example.com', 'V');
    await addMember(env, owner.workspaceId, v.userId, 'viewer');
    expect((await v.client.get(`${ws()}/workflows`)).status).toBe(200);
    expect((await createWorkflow(FULL, v.client)).status).toBe(403);
    const other = await registerUser(env, 'x@example.com', 'X');
    expect((await other.client.get(`${ws(other.workspaceId)}/workflows/${id}`)).status).toBe(404);
  });
});

describe('execução com aprovação (E2E, workspace pessoal)', () => {
  it('pausa na aprovação, exige confirmação, aprova e conclui; tudo registrado', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [
      { fieldType: 'cnpj', value: '11.222.333/0001-81' },
    ]);
    const started = await run(id, { primaryDocumentId: doc });
    expect(started.status).toBe(201);
    expect(started.json.status).toBe('awaiting_approval');
    expect(started.json.log.map((l: { status: string }) => l.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'awaiting_approval',
    ]);
    const eid = started.json.id as string;

    // Notificação de aprovação pendente (o próprio usuário, em workspace pessoal).
    const n1 = await owner.client.get('/api/me/notifications');
    expect(n1.json.notifications[0].kind).toBe('workflow_approval_pending');
    expect(n1.json.notifications[0].data.executionId).toBe(eid);

    // Sem confirmação irreversível: 400 e continua aguardando.
    const noConfirm = await decide(eid, { decision: 'approved' });
    expect(noConfirm.status).toBe(400);
    expect((await owner.client.get(`${ws()}/workflow-executions/${eid}`)).json.status).toBe(
      'awaiting_approval',
    );

    const ok = await decide(eid, { decision: 'approved', confirm: true, note: 'ok' });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('completed');
    expect(ok.json.log.at(-1).kind).toBe('output');

    // Documento gerado de verdade, a partir do campo extraído (não inventado).
    const gen = await env.db.select().from(schema.generatedDocuments);
    expect(gen).toHaveLength(1);
    expect(gen[0]?.content).toContain('11.222.333/0001-81');

    const appr = await env.db.select().from(schema.approvals);
    expect(appr).toHaveLength(1);
    expect(appr[0]).toMatchObject({
      subjectType: 'workflow_execution',
      subjectId: eid,
      decision: 'approved',
      decidedBy: owner.userId,
    });
    const actions = (await env.db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['workflow.started', 'workflow.approved']));

    // Estado final não guarda dados extraídos.
    const row = (
      await env.db
        .select()
        .from(schema.workflowExecutions)
        .where(eq(schema.workflowExecutions.id, eid))
    )[0];
    expect(JSON.parse(row!.stepLog!).ctx).toBeNull();

    // Decidir de novo é 409.
    expect((await decide(eid, { decision: 'approved', confirm: true })).status).toBe(409);
  });

  it('rejeitar encerra como rejected, sem gerar saída e sem exigir confirmação', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '1' }]);
    const eid = (await run(id, { primaryDocumentId: doc })).json.id as string;
    const r = await decide(eid, { decision: 'rejected', note: 'não' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('rejected');
    expect(r.json.log.some((l: { kind: string }) => l.kind === 'output')).toBe(false);
    const n = await owner.client.get('/api/me/notifications');
    expect(n.json.notifications.map((x: { kind: string }) => x.kind)).toContain(
      'workflow_rejected',
    );
  });

  it('cancelar só vale enquanto aguarda aprovação', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '1' }]);
    const eid = (await run(id, { primaryDocumentId: doc })).json.id as string;
    expect((await owner.client.post(`${ws()}/workflow-executions/${eid}/cancel`)).status).toBe(200);
    expect((await owner.client.post(`${ws()}/workflow-executions/${eid}/cancel`)).status).toBe(409);
    expect((await decide(eid, { decision: 'approved', confirm: true })).status).toBe(409);
  });
});

describe('equipe: separação de funções', () => {
  it('quem iniciou não aprova; aprovador de outra pessoa aprova; viewer não decide', async () => {
    const id = await wfId();
    const editor = await registerUser(env, 'e@example.com', 'E');
    const approver = await registerUser(env, 'a@example.com', 'A');
    const viewer = await registerUser(env, 'v@example.com', 'V');
    await addMember(env, owner.workspaceId, editor.userId, 'editor');
    await addMember(env, owner.workspaceId, approver.userId, 'approver');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '9' }]);

    const started = await run(id, { primaryDocumentId: doc }, editor.client);
    expect(started.status).toBe(201);
    const eid = started.json.id as string;

    // Quem iniciou não aprova a própria (editor nem tem a permissão); o iniciador "owner" também não.
    expect((await decide(eid, { decision: 'approved' }, editor.client)).status).toBe(403);
    expect((await decide(eid, { decision: 'approved' }, viewer.client)).status).toBe(403);

    // Aprovadores (owner e approver) foram notificados; o iniciador, não.
    const nApprover = await approver.client.get('/api/me/notifications');
    expect(nApprover.json.notifications[0].kind).toBe('workflow_approval_pending');
    const nEditor = await editor.client.get('/api/me/notifications');
    expect(nEditor.json.notifications).toHaveLength(0);

    const ok = await decide(eid, { decision: 'approved' }, approver.client);
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('completed');
    const nDone = await editor.client.get('/api/me/notifications');
    expect(nDone.json.notifications[0].kind).toBe('workflow_completed');
  });

  it('owner que iniciou a execução também não aprova em equipe', async () => {
    const id = await wfId();
    const m = await registerUser(env, 'm@example.com', 'M');
    await addMember(env, owner.workspaceId, m.userId, 'viewer');
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '9' }]);
    const eid = (await run(id, { primaryDocumentId: doc })).json.id as string;
    expect((await decide(eid, { decision: 'approved', confirm: true })).status).toBe(403);
  });
});

describe('falhas honestas', () => {
  it('sem análise ou com análise desatualizada: falha, sem inventar dados', async () => {
    const id = await wfId();
    for (const opts of [{ analysed: false }, { stale: true }]) {
      const doc = await seedDoc(owner.workspaceId, owner.userId, [], opts);
      const r = await run(id, { primaryDocumentId: doc });
      expect(r.status).toBe(201);
      expect(r.json.status).toBe('failed');
      expect(r.json.log[0].error).toMatch(/análise/);
    }
    expect(await env.db.select().from(schema.generatedDocuments)).toHaveLength(0);
  });

  it('campo obrigatório ausente reprova a validação e não repete (sem retry)', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cpf', value: '1' }]);
    const r = await run(id, { primaryDocumentId: doc });
    expect(r.json.status).toBe('failed');
    const failed = r.json.log.at(-1);
    expect(failed.kind).toBe('validate');
    expect(failed.attempts).toBe(1);
    expect(failed.error).toMatch(/cnpj/);
  });

  it('placeholder sem valor único fica em branco e é reportado', async () => {
    const id = await wfId([
      { kind: 'input_extract', config: { input: 'primary' } },
      {
        kind: 'generate',
        config: {
          templateKey: 'declaracao',
          title: 'D',
          mapping: { declarante: { fieldType: 'cnpj' } },
        },
      },
    ]);
    const doc = await seedDoc(owner.workspaceId, owner.userId, [
      { fieldType: 'cnpj', value: '1' },
      { fieldType: 'cnpj', value: '2' },
    ]);
    const r = await run(id, { primaryDocumentId: doc });
    expect(r.json.status).toBe('completed');
    const gen = r.json.log.find((l: { kind: string }) => l.kind === 'generate');
    expect(gen.result.unresolved[0]).toMatchObject({
      placeholder: 'declarante',
      reason: 'ambiguous',
    });
    const stored = (await env.db.select().from(schema.generatedDocuments))[0]!;
    expect(stored.content).toContain('{{declarante}}');
  });

  it('tempo total esgotado encerra como timed_out', async () => {
    const e2 = await createTestEnv({ config: { workflowLimits: { totalTimeoutMs: 0 } } });
    env = e2;
    owner = await registerUser(env, 'o2@example.com', 'Owner');
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '1' }]);
    const r = await run(id, { primaryDocumentId: doc });
    expect(r.json.status).toBe('timed_out');
    expect(r.json.log[0].status).toBe('timed_out');
    const n = await owner.client.get('/api/me/notifications');
    expect(n.json.notifications[0].kind).toBe('workflow_timed_out');
  });
});

describe('entradas e isolamento', () => {
  it('exige as entradas e recusa documento de outro workspace (404)', async () => {
    const id = await wfId();
    expect((await run(id, {})).status).toBe(400);
    const other = await registerUser(env, 'x@example.com', 'X');
    const foreign = await seedDoc(other.workspaceId, other.userId, [
      { fieldType: 'cnpj', value: '1' },
    ]);
    expect((await run(id, { primaryDocumentId: foreign })).status).toBe(404);
    expect(await env.db.select().from(schema.workflowExecutions)).toHaveLength(0);
  });

  it('execução de outro workspace não é acessível', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '1' }]);
    const eid = (await run(id, { primaryDocumentId: doc })).json.id as string;
    const other = await registerUser(env, 'x@example.com', 'X');
    const w = other.workspaceId;
    expect((await other.client.get(`${ws(w)}/workflow-executions/${eid}`)).status).toBe(404);
    expect((await decide(eid, { decision: 'rejected' }, other.client, w)).status).toBe(404);
  });

  it('comparação por campos exige duas entradas e resume igual/alterado', async () => {
    const id = await wfId([
      { kind: 'input_extract', config: { input: 'primary' } },
      { kind: 'input_extract', config: { input: 'secondary' } },
      { kind: 'compare', config: {} },
    ]);
    const a = await seedDoc(owner.workspaceId, owner.userId, [
      { fieldType: 'money', value: '100,00', label: 'total' },
      { fieldType: 'cnpj', value: '1' },
    ]);
    const b = await seedDoc(owner.workspaceId, owner.userId, [
      { fieldType: 'money', value: '120,00', label: 'total' },
      { fieldType: 'cnpj', value: '1' },
    ]);
    expect((await run(id, { primaryDocumentId: a })).status).toBe(400);
    const r = await run(id, { primaryDocumentId: a, secondaryDocumentId: b });
    expect(r.json.status).toBe('completed');
    const cmp = r.json.log.at(-1).result;
    expect(cmp).toMatchObject({ equal: 1, changed: 1 });
  });
});

describe('notificações', () => {
  it('marcar como lida afeta só as do próprio usuário', async () => {
    const id = await wfId();
    const doc = await seedDoc(owner.workspaceId, owner.userId, [{ fieldType: 'cnpj', value: '1' }]);
    await run(id, { primaryDocumentId: doc });
    const list = await owner.client.get('/api/me/notifications');
    expect(list.json.unread).toBe(1);
    const other = await registerUser(env, 'x@example.com', 'X');
    await other.client.post('/api/me/notifications/read', {
      ids: list.json.notifications.map((n: { id: string }) => n.id),
    });
    expect((await owner.client.get('/api/me/notifications')).json.unread).toBe(1);
    await owner.client.post('/api/me/notifications/read', {});
    expect((await owner.client.get('/api/me/notifications')).json.unread).toBe(0);
  });
});
