import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PROFILES_PER_USER } from '@docupilot/shared';
import { toBase64 } from '../crypto/pii';
import {
  Client,
  createTestEnv,
  eq,
  pdfBytes,
  registerUser,
  schema,
  type TestEnv,
} from '../test/helpers';

const KEY = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const CPF = '111.444.777-35';
const CPF_DIGITS = '11144477735';
const NAME = 'Zacarias Quimerico Ferreira';

let env: TestEnv;
let a: Awaited<ReturnType<typeof registerUser>>;
let b: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  env = await createTestEnv({ config: { piiKey: KEY } });
  a = await registerUser(env, 'a@example.com', 'Ana');
  b = await registerUser(env, 'b@example.com', 'Beto');
});

const grant = (c: Client) => c.post('/api/me/consents', { purpose: 'pii_profile' });
const body = (over: Record<string, unknown> = {}) => ({
  label: 'Pessoal',
  fields: { cpf: CPF, full_name: NAME, birth_date: '05/03/1990' },
  ...over,
});
const create = async (c: Client = a.client, over: Record<string, unknown> = {}) => {
  const res = await c.post('/api/me/profiles', body(over));
  expect(res.status).toBe(201);
  return res.json.id as string;
};
const auditActions = async () =>
  (await env.db.select().from(schema.auditLogs)).map((r) => r.action);

describe('consentimento', () => {
  it('sem consentimento ativo, criar é 403 CONSENT_REQUIRED e nada é gravado', async () => {
    const res = await a.client.post('/api/me/profiles', body());
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('CONSENT_REQUIRED');
    expect(await env.db.select().from(schema.personalDataProfiles)).toHaveLength(0);
  });

  it('com consentimento cria; revogar bloqueia criar/alterar mas mantém ler, exportar e excluir', async () => {
    await grant(a.client);
    const id = await create();
    expect((await a.client.request('DELETE', '/api/me/consents/pii_profile')).status).toBe(200);

    expect((await a.client.post('/api/me/profiles', body())).status).toBe(403);
    expect((await a.client.request('PUT', `/api/me/profiles/${id}`, body())).status).toBe(403);
    expect((await a.client.get(`/api/me/profiles/${id}`)).status).toBe(200);
    expect((await a.client.post(`/api/me/profiles/${id}/export`, { confirm: true })).status).toBe(
      200,
    );
    expect(
      (await a.client.request('DELETE', `/api/me/profiles/${id}`, { confirm: true })).status,
    ).toBe(200);
  });
});

describe('conteúdo e validação', () => {
  beforeEach(async () => {
    await grant(a.client);
  });

  it('lê de volta a forma canônica e a listagem não traz dado pessoal', async () => {
    const id = await create();
    const got = await a.client.get(`/api/me/profiles/${id}`);
    expect(got.json.fields).toEqual({
      cpf: CPF_DIGITS,
      full_name: NAME,
      birth_date: '1990-03-05',
    });
    const list = await a.client.get('/api/me/profiles');
    expect(list.json.profiles).toHaveLength(1);
    const text = JSON.stringify(list.json);
    expect(text).not.toContain(CPF_DIGITS);
    expect(text).not.toContain(NAME);
    expect(list.json.profiles[0]).toEqual(expect.objectContaining({ id, label: 'Pessoal' }));
    expect(Object.keys(list.json.profiles[0]).sort()).toEqual([
      'createdAt',
      'id',
      'label',
      'updatedAt',
    ]);
  });

  it('recusa CPF inválido, campo desconhecido e perfil vazio, sem ecoar o valor', async () => {
    const bad = await a.client.post(
      '/api/me/profiles',
      body({ fields: { cpf: '111.444.777-36' } }),
    );
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).not.toContain('777-36');
    expect((await a.client.post('/api/me/profiles', body({ fields: { senha: 'x' } }))).status).toBe(
      400,
    );
    expect((await a.client.post('/api/me/profiles', body({ fields: { city: '  ' } }))).status).toBe(
      400,
    );
  });

  it('atualiza com novo IV e mantém o mesmo id', async () => {
    const id = await create();
    const before = (await env.db.select().from(schema.personalDataProfiles))[0]!;
    const put = await a.client.request(
      'PUT',
      `/api/me/profiles/${id}`,
      body({ label: 'Novo', fields: { cpf: CPF, city: 'Salvador' } }),
    );
    expect(put.status).toBe(200);
    const after = (await env.db.select().from(schema.personalDataProfiles))[0]!;
    expect(after.iv).not.toBe(before.iv);
    expect(after.encryptedPayload).not.toBe(before.encryptedPayload);
    expect((await a.client.get(`/api/me/profiles/${id}`)).json.fields).toEqual({
      cpf: CPF_DIGITS,
      city: 'Salvador',
    });
  });

  it('limita a quantidade de perfis por usuário', async () => {
    for (let i = 0; i < MAX_PROFILES_PER_USER; i++) await create(a.client, { label: `p${i}` });
    const res = await a.client.post('/api/me/profiles', body());
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('isolamento entre usuários', () => {
  it('outro usuário recebe 404 em ler, alterar, exportar e excluir; a listagem dele é vazia', async () => {
    await grant(a.client);
    await grant(b.client);
    const id = await create();
    expect((await b.client.get(`/api/me/profiles/${id}`)).status).toBe(404);
    expect((await b.client.request('PUT', `/api/me/profiles/${id}`, body())).status).toBe(404);
    expect((await b.client.post(`/api/me/profiles/${id}/export`, { confirm: true })).status).toBe(
      404,
    );
    expect(
      (await b.client.request('DELETE', `/api/me/profiles/${id}`, { confirm: true })).status,
    ).toBe(404);
    expect((await b.client.get('/api/me/profiles')).json.profiles).toEqual([]);
    expect(await env.db.select().from(schema.personalDataProfiles)).toHaveLength(1);
  });

  it('sem login é 401', async () => {
    const anon = new Client(env);
    expect((await anon.get('/api/me/profiles')).status).toBe(401);
  });
});

describe('criptografia em repouso', () => {
  beforeEach(async () => {
    await grant(a.client);
  });

  it('o D1 não contém o dado em texto puro', async () => {
    await create();
    const row = (await env.db.select().from(schema.personalDataProfiles))[0]!;
    const dump = JSON.stringify(row);
    for (const secret of [CPF, CPF_DIGITS, NAME, '1990-03-05', 'Zacarias']) {
      expect(dump).not.toContain(secret);
    }
    const audit = JSON.stringify(await env.db.select().from(schema.auditLogs));
    expect(audit).not.toContain(CPF_DIGITS);
    expect(audit).not.toContain(NAME);
  });

  it('a busca do workspace não encontra o dado do perfil', async () => {
    await create();
    const ws = `/api/workspaces/${a.workspaceId}`;
    for (const q of [CPF_DIGITS, 'Zacarias', 'Quimerico']) {
      const res = await a.client.get(`${ws}/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json.results)).toBe(true);
      expect(res.json.results).toEqual([]);
    }
  });

  it('adulterar o texto cifrado faz a leitura falhar, sem vazar nada', async () => {
    const id = await create();
    const row = (await env.db.select().from(schema.personalDataProfiles))[0]!;
    const flipped = (row.encryptedPayload[0] === 'A' ? 'B' : 'A') + row.encryptedPayload.slice(1);
    await env.db
      .update(schema.personalDataProfiles)
      .set({ encryptedPayload: flipped })
      .where(eq(schema.personalDataProfiles.id, id));
    const res = await a.client.get(`/api/me/profiles/${id}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.json)).not.toContain(CPF_DIGITS);
  });

  it('trocar a linha de dono no banco (AAD) impede a leitura', async () => {
    const id = await create();
    await env.db
      .update(schema.personalDataProfiles)
      .set({ userId: b.userId })
      .where(eq(schema.personalDataProfiles.id, id));
    const res = await b.client.get(`/api/me/profiles/${id}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.json)).not.toContain(CPF_DIGITS);
  });

  it('chave diferente não decifra', async () => {
    const id = await create();
    const other = { ...env.config, piiKey: toBase64(crypto.getRandomValues(new Uint8Array(32))) };
    const { createApp } = await import('../app');
    const app = createApp({ db: env.db, storage: env.storage, config: other });
    const res = await app.request(`http://localhost/api/me/profiles/${id}`, {
      headers: { cookie: a.client.cookie },
    });
    expect(res.status).toBe(500);
  });
});

describe('sem chave configurada (R4)', () => {
  it.each([
    ['ausente', undefined],
    ['curta', toBase64(new Uint8Array(16))],
    ['inválida', '%%%não-base64%%%'],
  ])(
    'chave %s: 503 SERVICE_NOT_CONFIGURED e /health diz que não está configurado',
    async (_n, piiKey) => {
      const e = await createTestEnv({ config: { piiKey } });
      const u = await registerUser(e, 'x@example.com');
      await grant(u.client);
      const res = await u.client.post('/api/me/profiles', body());
      expect(res.status).toBe(503);
      expect(res.json.error.code).toBe('SERVICE_NOT_CONFIGURED');
      expect(await e.db.select().from(schema.personalDataProfiles)).toHaveLength(0);
      const health = await new Client(e).get('/api/health');
      expect(health.json.pii).toEqual({ configured: false });
    },
  );

  it('com chave válida o /health informa configurado', async () => {
    expect((await new Client(env).get('/api/health')).json.pii).toEqual({ configured: true });
  });
});

describe('auditoria', () => {
  it('registra criação, leitura (a cada vez), atualização, exportação e exclusão, só metadados', async () => {
    await grant(a.client);
    const id = await create();
    await a.client.get(`/api/me/profiles/${id}`);
    await a.client.get(`/api/me/profiles/${id}`);
    await a.client.request('PUT', `/api/me/profiles/${id}`, body());
    await a.client.post(`/api/me/profiles/${id}/export`, { confirm: true });
    await a.client.request('DELETE', `/api/me/profiles/${id}`, { confirm: true });
    const actions = await auditActions();
    expect(actions.filter((x) => x === 'profile.read')).toHaveLength(2);
    for (const x of ['profile.created', 'profile.updated', 'profile.exported', 'profile.deleted']) {
      expect(actions.filter((y) => y === x)).toHaveLength(1);
    }
  });

  it('exportar e excluir exigem confirm:true', async () => {
    await grant(a.client);
    const id = await create();
    expect((await a.client.post(`/api/me/profiles/${id}/export`, {})).status).toBe(400);
    expect((await a.client.post(`/api/me/profiles/${id}/export`, { confirm: 'sim' })).status).toBe(
      400,
    );
    expect((await a.client.request('DELETE', `/api/me/profiles/${id}`, {})).status).toBe(400);
    expect(await env.db.select().from(schema.personalDataProfiles)).toHaveLength(1);
  });
});

describe('exclusão', () => {
  it('apaga o perfil e os campos extraídos que apontam para ele (e só esses)', async () => {
    await grant(a.client);
    const id = await create();
    // Documento qualquer para pendurar os campos de teste.
    const ws = `/api/workspaces/${a.workspaceId}`;
    const bytes = pdfBytes(300);
    const created = await a.client.post(`${ws}/uploads`, {
      fileName: 'x.pdf',
      mime: 'application/pdf',
      size: bytes.length,
      sha256: '1'.padStart(64, '0'),
    });
    env.storage!.put(`ws/${a.workspaceId}/${created.json.uploadId}`, bytes);
    const done = await a.client.post(`${ws}/uploads/${created.json.uploadId}/complete`);
    const documentId = done.json.document.id as string;
    const versionId = done.json.versionId as string;
    const base = {
      documentId,
      versionId,
      workspaceId: a.workspaceId,
      fieldType: 'cpf',
      rawValue: CPF,
      normalizedValue: CPF_DIGITS,
      patternId: 'cpf',
      confidence: 1,
      sourceKind: 'deterministic',
    };
    await env.db.insert(schema.extractedFields).values([
      { ...base, personalProfileId: id },
      { ...base, personalProfileId: null },
    ] as never);
    expect(await env.db.select().from(schema.extractedFields)).toHaveLength(2);

    expect(
      (await a.client.request('DELETE', `/api/me/profiles/${id}`, { confirm: true })).status,
    ).toBe(200);
    expect(await env.db.select().from(schema.personalDataProfiles)).toHaveLength(0);
    const left = await env.db.select().from(schema.extractedFields);
    expect(left).toHaveLength(1);
    expect(left[0]?.personalProfileId).toBeNull();
  });
});
