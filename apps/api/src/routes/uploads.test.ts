import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  Client,
  createTestEnv,
  eq,
  pdfBytes,
  registerUser,
  schema,
  setSetting,
  sha,
  type TestEnv,
} from '../test/helpers';

let env: TestEnv;
let owner: Awaited<ReturnType<typeof registerUser>>;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'owner@example.com');
});

const body = (over: Record<string, unknown> = {}) => ({
  fileName: 'contrato.pdf',
  mime: 'application/pdf',
  size: 200,
  sha256: sha,
  ...over,
});
const base = () => `/api/workspaces/${owner.workspaceId}`;

async function requestUpload(
  c: Client,
  over: Record<string, unknown> = {},
  ws = owner.workspaceId,
) {
  return c.post(`/api/workspaces/${ws}/uploads`, body(over));
}

describe('emissão da URL assinada', () => {
  it('devolve URL, cabeçalhos e validade; não grava a URL na auditoria', async () => {
    const res = await requestUpload(owner.client);
    expect(res.status).toBe(201);
    expect(res.json.url).toContain('storage.test');
    expect(res.json.method).toBe('PUT');
    const logs = JSON.stringify(await env.db.select().from(schema.auditLogs));
    expect(logs).not.toContain('storage.test');
    expect(logs).toContain('upload.requested');
  });

  it('retorna 503 STORAGE_NOT_CONFIGURED quando não há armazenamento', async () => {
    const none = await createTestEnv({ storage: false });
    const u = await registerUser(none, 'x@example.com');
    const res = await u.client.post(`/api/workspaces/${u.workspaceId}/uploads`, body());
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('valida o corpo (MIME fora da lista, hash inválido)', async () => {
    expect((await requestUpload(owner.client, { mime: 'application/x-msdownload' })).status).toBe(
      400,
    );
    expect((await requestUpload(owner.client, { sha256: 'xyz' })).status).toBe(400);
  });

  it('aplica o limite de tamanho por arquivo', async () => {
    const res = await requestUpload(owner.client, { size: 26 * 1024 ** 2 });
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe('FILE_TOO_LARGE');
  });

  it('aplica a quota de armazenamento por workspace (system_settings)', async () => {
    await setSetting(env, 'quota.storageBytesPerWorkspace', '100');
    const res = await requestUpload(owner.client, { size: 200 });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('aplica a quota de documentos por workspace', async () => {
    await setSetting(env, 'quota.documentsPerWorkspace', '0');
    expect((await requestUpload(owner.client)).json.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('recusa pasta de outro workspace', async () => {
    const other = await registerUser(env, 'other@example.com');
    const [folder] = await env.db
      .insert(schema.folders)
      .values({ workspaceId: other.workspaceId, name: 'x', createdBy: other.userId })
      .returning();
    expect((await requestUpload(owner.client, { folderId: folder!.id })).status).toBe(404);
  });
});

describe('conclusão e validação do conteúdo', () => {
  async function start(over: Record<string, unknown> = {}) {
    const res = await requestUpload(owner.client, over);
    return res.json.uploadId as string;
  }
  const key = (id: string) => `ws/${owner.workspaceId}/${id}`;

  it('cria documento, versão e hash e atualiza contadores', async () => {
    const id = await start();
    env.storage!.put(key(id), pdfBytes(200));
    const done = await owner.client.post(`${base()}/uploads/${id}/complete`);
    expect(done.status).toBe(201);
    expect(done.json.document.status).toBe('needs_text');
    const list = await owner.client.get(`${base()}/documents`);
    expect(list.json.documents).toHaveLength(1);
    const ws = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(ws.storageBytesUsed).toBe(200);
    expect(ws.documentCount).toBe(1);
    const hashes = await env.db.select().from(schema.documentHashes);
    expect(hashes[0]?.verifiedByStorage).toBe(true);
  });

  it('responde 409 se o arquivo ainda não foi enviado (sem rejeitar o upload)', async () => {
    const id = await start();
    expect((await owner.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(409);
    env.storage!.put(key(id), pdfBytes(200));
    expect((await owner.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(201);
  });

  it('exclui o objeto e recusa quando o conteúdo não bate com o tipo declarado', async () => {
    const id = await start();
    const png = new Uint8Array(200);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    env.storage!.put(key(id), png);
    const res = await owner.client.post(`${base()}/uploads/${id}/complete`);
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('FILE_CONTENT_MISMATCH');
    expect(env.storage!.objects.has(key(id))).toBe(false);
    expect((await env.db.select().from(schema.uploads))[0]?.status).toBe('rejected');
    expect(await env.db.select().from(schema.documents)).toHaveLength(0);
  });

  it('recusa quando o tamanho real difere do declarado', async () => {
    const id = await start({ size: 200 });
    env.storage!.put(key(id), pdfBytes(300));
    expect((await owner.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(422);
    expect(env.storage!.objects.has(key(id))).toBe(false);
  });

  it('recusa upload expirado e remove o objeto', async () => {
    const id = await start();
    env.storage!.put(key(id), pdfBytes(200));
    await env.db.update(schema.uploads).set({ expiresAt: Date.now() - 1 });
    expect((await owner.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(409);
    expect(env.storage!.objects.has(key(id))).toBe(false);
  });

  it('não permite concluir duas vezes', async () => {
    const id = await start();
    env.storage!.put(key(id), pdfBytes(200));
    await owner.client.post(`${base()}/uploads/${id}/complete`);
    expect((await owner.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(409);
  });
});

describe('papéis e isolamento multi-tenant', () => {
  it('viewer lê mas não envia; editor envia mas não gerencia', async () => {
    const viewer = await registerUser(env, 'viewer@example.com');
    const editor = await registerUser(env, 'editor@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    await addMember(env, owner.workspaceId, editor.userId, 'editor');
    expect((await viewer.client.get(`${base()}/documents`)).status).toBe(200);
    expect((await requestUpload(viewer.client)).status).toBe(403);
    expect((await requestUpload(editor.client)).status).toBe(201);
  });

  it('usuário B não acessa documentos nem uploads do workspace de A (404)', async () => {
    const id = (await requestUpload(owner.client)).json.uploadId as string;
    env.storage!.put(`ws/${owner.workspaceId}/${id}`, pdfBytes(200));
    await owner.client.post(`${base()}/uploads/${id}/complete`);

    const intruder = await registerUser(env, 'intruder@example.com');
    expect((await intruder.client.get(`${base()}/documents`)).status).toBe(404);
    expect((await requestUpload(intruder.client, {}, owner.workspaceId)).status).toBe(404);
    expect((await intruder.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(404);
    expect((await new Client(env).get(`${base()}/documents`)).status).toBe(401);
  });

  it('editor do mesmo workspace não conclui o upload de outra pessoa', async () => {
    const editor = await registerUser(env, 'ed2@example.com');
    await addMember(env, owner.workspaceId, editor.userId, 'editor');
    const id = (await requestUpload(owner.client)).json.uploadId as string;
    env.storage!.put(`ws/${owner.workspaceId}/${id}`, pdfBytes(200));
    expect((await editor.client.post(`${base()}/uploads/${id}/complete`)).status).toBe(404);
  });

  it('upload de A concluído pelo próprio workspace de B (id trocado) retorna 404', async () => {
    const b = await registerUser(env, 'b2@example.com');
    const id = (await requestUpload(owner.client)).json.uploadId as string;
    expect(
      (await b.client.post(`/api/workspaces/${b.workspaceId}/uploads/${id}/complete`)).status,
    ).toBe(404);
  });
});
