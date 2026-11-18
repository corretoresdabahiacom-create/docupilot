import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc } from '@docupilot/shared';
import {
  addMember,
  createTestEnv,
  registerUser,
  schema,
  setSetting,
  type TestEnv,
} from '../test/helpers';

let env: TestEnv;
let owner: Awaited<ReturnType<typeof registerUser>>;
const ws = () => `/api/workspaces/${owner.workspaceId}`;

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'o@example.com', 'Owner');
});

async function member(role: string, email = `${role}@example.com`) {
  const u = await registerUser(env, email, role);
  await addMember(env, owner.workspaceId, u.userId, role);
  return u;
}
const create = async (over: Record<string, unknown> = {}) => {
  const r = await owner.client.post(`${ws()}/generated`, { title: 'Meu texto', ...over });
  expect(r.status).toBe(201);
  return r.json.id as string;
};

describe('criação', () => {
  it('cria em branco e a partir de modelo, sem inventar valores', async () => {
    const id = await create();
    const got = await owner.client.get(`${ws()}/generated/${id}`);
    expect(got.status).toBe(200);
    expect(got.json.version).toBe(1);

    const t = await owner.client.post(`${ws()}/generated`, {
      title: 'Proposta',
      template: 'proposta',
      values: { cliente: 'ACME' },
    });
    expect(t.status).toBe(201);
    const full = await owner.client.get(`${ws()}/generated/${t.json.id}`);
    const text = JSON.stringify(full.json.content);
    expect(text).toContain('ACME');
    expect(text).toContain('{{empresa}}'); // não preenchido continua visível
    expect(t.json.placeholders).toContain('empresa');
  });

  it('modelo desconhecido é 400', async () => {
    const r = await owner.client.post(`${ws()}/generated`, { title: 'x', template: 'nao-existe' });
    expect(r.status).toBe(400);
  });
});

describe('conteúdo é revalidado no servidor', () => {
  it('remove script, javascript: e imagem remota', async () => {
    const id = await create();
    const bad = doc(
      { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'link',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
      { type: 'image', attrs: { src: 'https://evil.test/x.png' } },
      para('texto ok'),
    );
    const put = await owner.client.request('PUT', `${ws()}/generated/${id}`, {
      title: 'x',
      content: bad,
      version: 1,
    });
    // Ou rejeita, ou grava só a versão limpa — nunca o conteúdo perigoso.
    if (put.status === 200) {
      const got = await owner.client.get(`${ws()}/generated/${id}`);
      const s = JSON.stringify(got.json.content);
      expect(s).not.toContain('javascript:');
      expect(s).not.toContain('evil.test');
      expect(s).not.toContain('script');
      expect(s).toContain('texto ok');
    } else {
      expect(put.status).toBe(400);
    }
  });

  it('documento grande demais é rejeitado', async () => {
    const id = await create();
    const big = doc(para('a'.repeat(1_000_000)));
    const put = await owner.client.request('PUT', `${ws()}/generated/${id}`, {
      title: 'x',
      content: big,
      version: 1,
    });
    expect([400, 413]).toContain(put.status);
  });
});

describe('versionamento otimista', () => {
  it('versão velha é 409 e não sobrescreve', async () => {
    const id = await create();
    const ok = await owner.client.request('PUT', `${ws()}/generated/${id}`, {
      title: 'v2',
      content: doc(para('segunda')),
      version: 1,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.version).toBe(2);
    const stale = await owner.client.request('PUT', `${ws()}/generated/${id}`, {
      title: 'v-velha',
      content: doc(para('velha')),
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('CONFLICT');
    const got = await owner.client.get(`${ws()}/generated/${id}`);
    expect(JSON.stringify(got.json.content)).toContain('segunda');
  });
});

describe('permissões e isolamento', () => {
  it('viewer lê mas não cria, edita, exporta nem exclui', async () => {
    const id = await create();
    const v = await member('viewer');
    const vws = ws();
    expect((await v.client.get(`${vws}/generated`)).status).toBe(200);
    expect((await v.client.get(`${vws}/generated/${id}`)).status).toBe(200);
    expect((await v.client.post(`${vws}/generated`, { title: 'x' })).status).toBe(403);
    expect(
      (
        await v.client.request('PUT', `${vws}/generated/${id}`, {
          title: 'x',
          content: emptyDoc(),
          version: 1,
        })
      ).status,
    ).toBe(403);
    expect((await v.client.post(`${vws}/generated/${id}/exports`, { format: 'txt' })).status).toBe(
      403,
    );
    expect((await v.client.request('DELETE', `${vws}/generated/${id}`)).status).toBe(403);
  });

  it('editor edita e exporta; aprovador exporta mas não edita', async () => {
    const id = await create();
    const e = await member('editor');
    const a = await member('approver');
    expect((await e.client.post(`${ws()}/generated/${id}/exports`, { format: 'md' })).status).toBe(
      200,
    );
    expect((await a.client.post(`${ws()}/generated/${id}/exports`, { format: 'md' })).status).toBe(
      200,
    );
    expect(
      (
        await a.client.request('PUT', `${ws()}/generated/${id}`, {
          title: 'x',
          content: emptyDoc(),
          version: 1,
        })
      ).status,
    ).toBe(403);
  });

  it('outro workspace recebe 404 (sem vazar existência)', async () => {
    const id = await create();
    const other = await registerUser(env, 'x@example.com', 'X');
    expect((await other.client.get(`${ws()}/generated/${id}`)).status).toBe(404);
    expect(
      (await other.client.get(`/api/workspaces/${other.workspaceId}/generated/${id}`)).status,
    ).toBe(404);
  });
});

describe('exportação', () => {
  it('registra auditoria e uso; formato inválido é 400', async () => {
    const id = await create();
    expect(
      (await owner.client.post(`${ws()}/generated/${id}/exports`, { format: 'exe' })).status,
    ).toBe(400);
    const r = await owner.client.post(`${ws()}/generated/${id}/exports`, { format: 'pdf' });
    expect(r.status).toBe(200);
    const audit = (await env.db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(audit).toContain('generated.exported');
    const usage = await env.db.select().from(schema.usageRecords);
    expect(usage.some((u) => u.metric === 'exports')).toBe(true);
  });

  it('acima da cota mensal é 429', async () => {
    const id = await create();
    await setSetting(env, 'quota.exportsPerMonth', '2');
    const url = `${ws()}/generated/${id}/exports`;
    const codes = [] as number[];
    for (let i = 0; i < 4; i++)
      codes.push((await owner.client.post(url, { format: 'txt' })).status);
    expect(codes.slice(0, 2)).toEqual([200, 200]);
    expect(codes[3]).toBe(429);
  });
});

describe('exclusão', () => {
  it('owner exclui e depois é 404', async () => {
    const id = await create();
    expect((await owner.client.request('DELETE', `${ws()}/generated/${id}`)).status).toBe(200);
    expect((await owner.client.get(`${ws()}/generated/${id}`)).status).toBe(404);
  });
});
