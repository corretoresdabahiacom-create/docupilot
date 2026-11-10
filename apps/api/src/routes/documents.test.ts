import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@docupilot/shared';
import {
  addMember,
  Client,
  createTestEnv,
  eq,
  pdfBytes,
  registerUser,
  schema,
  setSetting,
  type TestEnv,
} from '../test/helpers';
import { buildSnippet, searchLike } from './search';

let env: TestEnv;
let owner: Awaited<ReturnType<typeof registerUser>>;
let counter = 0;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'owner@example.com');
  counter = 0;
});

const ws = () => `/api/workspaces/${owner.workspaceId}`;
const uniqueSha = () => (++counter).toString(16).padStart(64, '0');

/** Fluxo completo de upload: emite URL, simula o PUT e conclui. */
async function upload(
  c: Client,
  workspaceId: string,
  over: { fileName?: string; folderId?: string | null; documentId?: string; sha?: string } = {},
) {
  const sha256 = over.sha ?? uniqueSha();
  const bytes = pdfBytes(300 + counter);
  const created = await c.post(`/api/workspaces/${workspaceId}/uploads`, {
    fileName: over.fileName ?? `doc-${counter}.pdf`,
    mime: 'application/pdf',
    size: bytes.length,
    sha256,
    folderId: over.folderId,
    documentId: over.documentId,
  });
  if (created.status !== 201) return { created };
  const uploadId = created.json.uploadId as string;
  env.storage!.put(`ws/${workspaceId}/${uploadId}`, bytes);
  const done = await c.post(`/api/workspaces/${workspaceId}/uploads/${uploadId}/complete`);
  return { created, done, sha256, bytes };
}

async function newDoc(over: Parameters<typeof upload>[2] = {}, c = owner.client) {
  const r = await upload(c, owner.workspaceId, over);
  expect(r.done?.status).toBe(201);
  return {
    documentId: r.done!.json.document.id as string,
    versionId: r.done!.json.versionId as string,
    sha256: r.sha256!,
  };
}

const pagesUrl = (d: { documentId: string; versionId: string }) =>
  `${ws()}/documents/${d.documentId}/versions/${d.versionId}/pages`;
const completeUrl = (d: { documentId: string; versionId: string }) =>
  `${ws()}/documents/${d.documentId}/versions/${d.versionId}/extraction/complete`;

async function extract(
  d: { documentId: string; versionId: string },
  pages: { pageNumber: number; text: string }[],
  by: 'client' | 'client_ocr' = 'client',
) {
  const put = await owner.client.request('PUT', pagesUrl(d), { pages, extractedBy: by });
  expect(put.status).toBe(200);
  const done = await owner.client.post(completeUrl(d), {
    status: 'extracted',
    pageCount: pages.length,
    extractedBy: by,
  });
  expect(done.status).toBe(200);
}

describe('pastas', () => {
  it('cria hierarquia até 5 níveis e recusa o sexto', async () => {
    let parent: string | null = null;
    for (let i = 1; i <= 5; i++) {
      const res: any = await owner.client.post(`${ws()}/folders`, {
        name: `n${i}`,
        parentId: parent,
      });
      expect(res.status).toBe(201);
      expect(res.json.folder.depth).toBe(i);
      parent = res.json.folder.id;
    }
    const sixth = await owner.client.post(`${ws()}/folders`, { name: 'n6', parentId: parent });
    expect(sixth.status).toBe(400);
  });

  it('recusa nome repetido no mesmo nível (sem diferenciar maiúsculas)', async () => {
    await owner.client.post(`${ws()}/folders`, { name: 'Contratos' });
    const dup = await owner.client.post(`${ws()}/folders`, { name: 'contratos' });
    expect(dup.status).toBe(409);
  });

  it('mover recalcula a profundidade da subárvore e impede ciclos e estouro de nível', async () => {
    const mk = async (name: string, parentId: string | null = null) =>
      (await owner.client.post(`${ws()}/folders`, { name, parentId })).json.folder.id as string;
    const a = await mk('a');
    const b = await mk('b', a);
    const c = await mk('c', b);
    const other = await mk('other');

    const cycle = await owner.client.request('PATCH', `${ws()}/folders/${a}`, { parentId: c });
    expect(cycle.status).toBe(400);

    const moved = await owner.client.request('PATCH', `${ws()}/folders/${b}`, { parentId: other });
    expect(moved.status).toBe(200);
    const list = (await owner.client.get(`${ws()}/folders`)).json.folders as any[];
    expect(list.find((f) => f.id === b).depth).toBe(2);
    expect(list.find((f) => f.id === c).depth).toBe(3);

    // Cadeia de 3 níveis não cabe sob uma pasta de nível 4.
    let deep: string | null = null;
    for (let i = 0; i < 4; i++) deep = await mk(`d${i}`, deep);
    const tooDeep = await owner.client.request('PATCH', `${ws()}/folders/${b}`, { parentId: deep });
    expect(tooDeep.status).toBe(400);
  });

  it('só exclui pasta vazia', async () => {
    const f = (await owner.client.post(`${ws()}/folders`, { name: 'cheia' })).json.folder.id;
    await newDoc({ folderId: f });
    const res = await owner.client.request('DELETE', `${ws()}/folders/${f}`);
    expect(res.status).toBe(409);
  });

  it('editor não exclui pasta; viewer não cria', async () => {
    const editor = await registerUser(env, 'ed@example.com');
    await addMember(env, owner.workspaceId, editor.userId, 'editor');
    const viewer = await registerUser(env, 'vw@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    const f = (await editor.client.post(`${ws()}/folders`, { name: 'x' })).json.folder.id;
    expect((await editor.client.request('DELETE', `${ws()}/folders/${f}`)).status).toBe(403);
    expect((await viewer.client.post(`${ws()}/folders`, { name: 'y' })).status).toBe(403);
    expect((await viewer.client.get(`${ws()}/folders`)).status).toBe(200);
  });
});

describe('extração e busca (E2E)', () => {
  it('upload → extração → busca com página e trecho; acentos são ignorados', async () => {
    const d = await newDoc({ fileName: 'contrato.pdf' });
    await extract(d, [
      { pageNumber: 1, text: 'Cláusula primeira: objeto do contrato de locação.' },
      { pageNumber: 2, text: 'Cláusula segunda: o valor do aluguel é mensal.' },
    ]);

    const detail = await owner.client.get(`${ws()}/documents/${d.documentId}`);
    expect(detail.json.document.status).toBe('extracted');
    expect(detail.json.metadata.pageCount).toBe(2);
    expect(detail.json.metadata.extractedBy).toBe('client');

    const res = await owner.client.get(`${ws()}/search?q=${encodeURIComponent('clausula')}`);
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe('fts');
    expect(res.json.results.map((r: any) => r.pageNumber).sort()).toEqual([1, 2]);

    const one = await owner.client.get(`${ws()}/search?q=${encodeURIComponent('alugu')}`);
    expect(one.json.results).toHaveLength(1);
    expect(one.json.results[0]).toMatchObject({ documentId: d.documentId, pageNumber: 2 });
    expect(one.json.results[0].snippet).toContain(`${SNIPPET_OPEN}aluguel${SNIPPET_CLOSE}`);

    const none = await owner.client.get(`${ws()}/search?q=inexistente`);
    expect(none.json.results).toEqual([]);
  });

  it('consultas com operadores FTS não quebram a busca', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'texto simples sobre pagamento de tributos' }]);
    for (const q of ['pagamento AND', '"aberta', 'NEAR(a b)', 'pagamento*']) {
      const res = await owner.client.get(`${ws()}/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
    }
    expect((await owner.client.get(`${ws()}/search?q=***`)).status).toBe(400);
    expect((await owner.client.get(`${ws()}/search?q=a`)).status).toBe(400);
  });

  it('a busca só vê a versão atual e não vaza para outro workspace', async () => {
    const d = await newDoc({ fileName: 'a.pdf' });
    await extract(d, [{ pageNumber: 1, text: 'segredo industrial confidencial' }]);

    const other = await registerUser(env, 'other@example.com');
    const res = await other.client.get(`/api/workspaces/${other.workspaceId}/search?q=segredo`);
    expect(res.json.results).toEqual([]);
    // Consultar o workspace alheio é 404.
    expect((await other.client.get(`${ws()}/search?q=segredo`)).status).toBe(404);
    expect((await other.client.get(`${ws()}/documents/${d.documentId}`)).status).toBe(404);
    // Id de documento de A usado no workspace de B também é 404.
    const cross = await other.client.get(
      `/api/workspaces/${other.workspaceId}/documents/${d.documentId}`,
    );
    expect(cross.status).toBe(404);
  });

  it('texto vindo do navegador é higienizado e texto corrompido é recusado', async () => {
    const d = await newDoc();
    const put = await owner.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 1, text: 'abc\u0001def\u0000 ghi jkl mno pqr' }],
      extractedBy: 'client',
    });
    expect(put.status).toBe(200);
    const stored = await env.db.select().from(schema.documentPages);
    expect(stored[0]!.text).toBe('abcdef ghi jkl mno pqr');

    const bad = await owner.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 2, text: '�'.repeat(80) }],
      extractedBy: 'client',
    });
    expect(bad.status).toBe(400);
  });

  it('valida lote: páginas repetidas, limite por requisição e por página', async () => {
    const d = await newDoc();
    const dup = await owner.client.request('PUT', pagesUrl(d), {
      pages: [
        { pageNumber: 1, text: 'um dois três quatro' },
        { pageNumber: 1, text: 'cinco seis sete oito' },
      ],
      extractedBy: 'client',
    });
    expect(dup.status).toBe(400);
    const many = await owner.client.request('PUT', pagesUrl(d), {
      pages: Array.from({ length: 11 }, (_, i) => ({ pageNumber: i + 1, text: 'palavra palavra' })),
      extractedBy: 'client',
    });
    expect(many.status).toBe(400);
    const huge = await owner.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 1, text: 'x'.repeat(30_001) }],
      extractedBy: 'client',
    });
    expect(huge.status).toBe(400);
  });

  it('reenviar a mesma página substitui o texto e mantém o índice consistente', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'versão antiga do texto abacaxi' }]);
    await extract(d, [{ pageNumber: 1, text: 'versão nova do texto banana' }]);
    await env.db.run(
      sql`INSERT INTO document_pages_fts(document_pages_fts, rank) VALUES ('integrity-check', 1)`,
    );
    const old = await owner.client.get(`${ws()}/search?q=abacaxi`);
    const fresh = await owner.client.get(`${ws()}/search?q=banana`);
    expect(old.json.results).toEqual([]);
    expect(fresh.json.results).toHaveLength(1);
    const w = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(w.textCharsUsed).toBe('versão nova do texto banana'.length);
  });

  it('concluir sem texto enviado é recusado; needs_ocr descarta páginas parciais', async () => {
    const d = await newDoc();
    const empty = await owner.client.post(completeUrl(d), { status: 'extracted' });
    expect(empty.status).toBe(400);

    await owner.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 1, text: 'texto parcial bastante longo aqui' }],
      extractedBy: 'client',
    });
    const ocr = await owner.client.post(completeUrl(d), { status: 'needs_ocr', pageCount: 3 });
    expect(ocr.status).toBe(200);
    const detail = await owner.client.get(`${ws()}/documents/${d.documentId}`);
    expect(detail.json.document.status).toBe('needs_ocr');
    expect(await env.db.select().from(schema.documentPages)).toHaveLength(0);
    const w = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(w.textCharsUsed).toBe(0);
  });

  it('extraction_failed é registrado', async () => {
    const d = await newDoc();
    const res = await owner.client.post(completeUrl(d), { status: 'extraction_failed' });
    expect(res.status).toBe(200);
    expect((await owner.client.get(`${ws()}/documents/${d.documentId}`)).json.document.status).toBe(
      'extraction_failed',
    );
  });

  it('aplica a quota mensal de extrações e a de texto por workspace', async () => {
    await setSetting(env, 'quota.extractionsPerMonth', '1');
    const a = await newDoc();
    await extract(a, [{ pageNumber: 1, text: 'primeira extração permitida do mês' }]);
    const b = await newDoc();
    const blocked = await owner.client.request('PUT', pagesUrl(b), {
      pages: [{ pageNumber: 1, text: 'segunda extração deve ser barrada' }],
      extractedBy: 'client',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('QUOTA_EXCEEDED');

    const env2 = await createTestEnv();
    await setSetting(env2, 'quota.textCharsPerWorkspace', '30');
    const u = await registerUser(env2, 'q@example.com');
    const created = await u.client.post(`/api/workspaces/${u.workspaceId}/uploads`, {
      fileName: 'q.pdf',
      mime: 'application/pdf',
      size: 200,
      sha256: 'b'.repeat(64),
    });
    env2.storage!.put(`ws/${u.workspaceId}/${created.json.uploadId}`, pdfBytes());
    const done = await u.client.post(
      `/api/workspaces/${u.workspaceId}/uploads/${created.json.uploadId}/complete`,
    );
    const over = await u.client.request(
      'PUT',
      `/api/workspaces/${u.workspaceId}/documents/${done.json.document.id}/versions/${done.json.versionId}/pages`,
      {
        pages: [{ pageNumber: 1, text: 'texto com mais de trinta caracteres no total' }],
        extractedBy: 'client',
      },
    );
    expect(over.status).toBe(429);
  });

  it('viewer não envia texto', async () => {
    const d = await newDoc();
    const viewer = await registerUser(env, 'v@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    const res = await viewer.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 1, text: 'tentativa de viewer aqui' }],
      extractedBy: 'client',
    });
    expect(res.status).toBe(403);
  });
});

describe('OCR e consentimento', () => {
  it('OCR sem consentimento é recusado; com consentimento registrado, aceito', async () => {
    const d = await newDoc();
    const pages = [{ pageNumber: 1, text: 'texto reconhecido por OCR no navegador' }];
    const denied = await owner.client.request('PUT', pagesUrl(d), {
      pages,
      extractedBy: 'client_ocr',
    });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('CONSENT_REQUIRED');

    expect((await owner.client.post('/api/me/consents', { purpose: 'browser_ocr' })).status).toBe(
      201,
    );
    // Idempotente: não duplica o registro.
    expect((await owner.client.post('/api/me/consents', { purpose: 'browser_ocr' })).status).toBe(
      200,
    );
    const rows = await env.db.select().from(schema.userConsents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toContain('tesseract');

    await extract(d, pages, 'client_ocr');
    const detail = await owner.client.get(`${ws()}/documents/${d.documentId}`);
    expect(detail.json.metadata.extractedBy).toBe('client_ocr');
  });

  it('revogar o consentimento bloqueia novos envios de OCR', async () => {
    await owner.client.post('/api/me/consents', { purpose: 'browser_ocr' });
    expect((await owner.client.get('/api/me/consents')).json.consents).toHaveLength(1);
    await owner.client.request('DELETE', '/api/me/consents/browser_ocr');
    expect((await owner.client.get('/api/me/consents')).json.consents).toHaveLength(0);
    const d = await newDoc();
    const res = await owner.client.request('PUT', pagesUrl(d), {
      pages: [{ pageNumber: 1, text: 'ocr depois de revogar consentimento' }],
      extractedBy: 'client_ocr',
    });
    expect(res.status).toBe(403);
    expect((await owner.client.post('/api/me/consents', { purpose: 'outro' })).status).toBe(400);
  });
});

describe('duplicados e versões', () => {
  it('SHA-256 repetido devolve 409 DUPLICATE_FILE com o documento existente', async () => {
    const d = await newDoc({ sha: 'c'.repeat(64) });
    const again = await upload(owner.client, owner.workspaceId, { sha: 'c'.repeat(64) });
    expect(again.created.status).toBe(409);
    expect(again.created.json.error.code).toBe('DUPLICATE_FILE');
    expect(again.created.json.error.details.documentId).toBe(d.documentId);

    const forced = await owner.client.post(`${ws()}/uploads`, {
      fileName: 'copia.pdf',
      mime: 'application/pdf',
      size: 300,
      sha256: 'c'.repeat(64),
      allowDuplicate: true,
    });
    expect(forced.status).toBe(201);
  });

  it('precheck informa duplicado exato e documento de mesmo nome', async () => {
    const d = await newDoc({ fileName: 'ata.pdf', sha: 'd'.repeat(64) });
    const exact = await owner.client.post(`${ws()}/uploads/precheck`, {
      fileName: 'outro.pdf',
      sha256: 'd'.repeat(64),
    });
    expect(exact.json.duplicate.documentId).toBe(d.documentId);
    const sameName = await owner.client.post(`${ws()}/uploads/precheck`, {
      fileName: 'ata.pdf',
      sha256: 'e'.repeat(64),
    });
    expect(sameName.json.duplicate).toBeNull();
    expect(sameName.json.sameName.documentId).toBe(d.documentId);
  });

  it('novo envio com documentId cria versão 2, troca a atual e zera a extração', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'conteúdo da primeira versão do arquivo' }]);
    const v2 = await upload(owner.client, owner.workspaceId, { documentId: d.documentId });
    expect(v2.done?.status).toBe(201);
    expect(v2.done!.json.versionNumber).toBe(2);

    const detail = await owner.client.get(`${ws()}/documents/${d.documentId}`);
    expect(detail.json.versions.map((v: any) => v.versionNumber)).toEqual([2, 1]);
    expect(detail.json.document.currentVersionId).toBe(v2.done!.json.versionId);
    expect(detail.json.document.status).toBe('needs_text');
    expect(detail.json.metadata).toBeNull();

    // A versão 1 deixa de aparecer na busca (só a versão atual é pesquisada).
    const res = await owner.client.get(`${ws()}/search?q=primeira`);
    expect(res.json.results).toEqual([]);

    const w = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(w.documentCount).toBe(1);
  });

  it('restaurar a versão anterior recoloca o texto na busca', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'conteúdo restaurável da primeira versão' }]);
    await upload(owner.client, owner.workspaceId, { documentId: d.documentId });
    const restore = await owner.client.post(
      `${ws()}/documents/${d.documentId}/versions/${d.versionId}/current`,
    );
    expect(restore.json.status).toBe('extracted');
    const found = await owner.client.get(`${ws()}/search?q=restauravel`);
    expect(found.json.results).toHaveLength(1);
    expect(found.json.results[0].documentId).toBe(d.documentId);
  });

  it('não exclui a versão atual; excluir versão antiga libera o espaço e o objeto', async () => {
    const d = await newDoc();
    const v2 = await upload(owner.client, owner.workspaceId, { documentId: d.documentId });
    const cur = await owner.client.request(
      'DELETE',
      `${ws()}/documents/${d.documentId}/versions/${v2.done!.json.versionId}`,
    );
    expect(cur.status).toBe(409);
    const before = env.storage!.objects.size;
    const old = await owner.client.request(
      'DELETE',
      `${ws()}/documents/${d.documentId}/versions/${d.versionId}`,
    );
    expect(old.status).toBe(200);
    expect(env.storage!.objects.size).toBe(before - 1);
    const w = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(w.storageBytesUsed).toBe(v2.bytes!.length);
  });

  it('limita a 50 versões por documento', async () => {
    const d = await newDoc();
    const rows = Array.from({ length: 49 }, (_, i) => ({
      id: crypto.randomUUID(),
      documentId: d.documentId,
      workspaceId: owner.workspaceId,
      versionNumber: i + 2,
      createdBy: owner.userId,
      storageKey: `k${i}`,
      sizeBytes: 1,
      mime: 'application/pdf',
      sha256: 'f'.repeat(64),
    }));
    await env.db.insert(schema.documentVersions).values(rows);
    const res = await upload(owner.client, owner.workspaceId, { documentId: d.documentId });
    expect(res.created.status).toBe(429);
    expect(res.created.json.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('versão de documento de outro workspace é 404', async () => {
    const d = await newDoc();
    const other = await registerUser(env, 'o2@example.com');
    const res = await upload(other.client, other.workspaceId, { documentId: d.documentId });
    expect(res.created.status).toBe(404);
  });
});

describe('detalhe, download, renomear/mover e exclusão', () => {
  it('lista por pasta, renomeia e move', async () => {
    const f = (await owner.client.post(`${ws()}/folders`, { name: 'pasta' })).json.folder.id;
    const d = await newDoc({ fileName: 'x.pdf' });
    expect((await owner.client.get(`${ws()}/documents?folderId=root`)).json.documents).toHaveLength(
      1,
    );
    expect((await owner.client.get(`${ws()}/documents?folderId=${f}`)).json.documents).toHaveLength(
      0,
    );
    const patch = await owner.client.request('PATCH', `${ws()}/documents/${d.documentId}`, {
      name: 'y.pdf',
      folderId: f,
    });
    expect(patch.status).toBe(200);
    expect((await owner.client.get(`${ws()}/documents?folderId=${f}`)).json.documents[0].name).toBe(
      'y.pdf',
    );
    const bad = await owner.client.request('PATCH', `${ws()}/documents/${d.documentId}`, {
      folderId: 'nao-existe',
    });
    expect(bad.status).toBe(404);
  });

  it('gera URL de download assinada e curta; viewer pode baixar', async () => {
    const d = await newDoc();
    const viewer = await registerUser(env, 'vw2@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    const res = await viewer.client.get(`${ws()}/documents/${d.documentId}/download-url`);
    expect(res.status).toBe(200);
    expect(res.json.url).toContain('storage.test');
    expect(res.json.expiresInSeconds).toBe(900);
    const none = await createTestEnv({ storage: false });
    const u = await registerUser(none, 'ns@example.com');
    expect(
      (await u.client.get(`/api/workspaces/${u.workspaceId}/documents/x/download-url`)).status,
    ).toBe(503);
  });

  it('pagina o texto para pré-visualização', async () => {
    const d = await newDoc();
    await extract(
      d,
      Array.from({ length: 10 }, (_, i) => ({
        pageNumber: i + 1,
        text: `página ${i + 1} do documento`,
      })),
    );
    await extract(d, [{ pageNumber: 11, text: 'página 11 do documento' }]);
    const first = await owner.client.get(`${ws()}/documents/${d.documentId}/pages?from=1`);
    expect(first.json.pages).toHaveLength(10);
    expect(first.json.hasMore).toBe(true);
    const next = await owner.client.get(`${ws()}/documents/${d.documentId}/pages?from=11`);
    expect(next.json.pages).toHaveLength(1);
    expect(next.json.hasMore).toBe(false);
  });

  it('excluir remove documento, versões, páginas, índice e objetos e ajusta contadores', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'texto que precisa sumir da busca' }]);
    await upload(owner.client, owner.workspaceId, { documentId: d.documentId });
    expect(env.storage!.objects.size).toBe(2);

    const viewer = await registerUser(env, 'vw3@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    expect(
      (await viewer.client.request('DELETE', `${ws()}/documents/${d.documentId}`)).status,
    ).toBe(403);

    const res = await owner.client.request('DELETE', `${ws()}/documents/${d.documentId}`);
    expect(res.status).toBe(200);
    expect(res.json.storageCleaned).toBe(true);
    expect(env.storage!.objects.size).toBe(0);
    expect(await env.db.select().from(schema.documents)).toHaveLength(0);
    expect(await env.db.select().from(schema.documentVersions)).toHaveLength(0);
    expect(await env.db.select().from(schema.documentPages)).toHaveLength(0);
    expect(await env.db.select().from(schema.documentHashes)).toHaveLength(0);
    expect((await owner.client.get(`${ws()}/search?q=sumir`)).json.results).toEqual([]);
    // O índice FTS5 não guarda resíduos: nenhum documento indexado e verificação de integridade.
    const indexed = await env.db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM document_pages_fts_docsize`,
    );
    expect(indexed[0]!.n).toBe(0);
    await env.db.run(
      sql`INSERT INTO document_pages_fts(document_pages_fts, rank) VALUES ('integrity-check', 1)`,
    );
    const w = (
      await env.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, owner.workspaceId))
    )[0]!;
    expect(w).toMatchObject({ storageBytesUsed: 0, documentCount: 0, textCharsUsed: 0 });
    expect((await owner.client.get(`${ws()}/documents/${d.documentId}`)).status).toBe(404);
  });

  it('exclusão de documento de outro workspace é 404 e não apaga nada', async () => {
    const d = await newDoc();
    const other = await registerUser(env, 'o3@example.com');
    const res = await other.client.request(
      'DELETE',
      `/api/workspaces/${other.workspaceId}/documents/${d.documentId}`,
    );
    expect(res.status).toBe(404);
    expect(await env.db.select().from(schema.documents)).toHaveLength(1);
  });
});

describe('busca alternativa (LIKE)', () => {
  it('encontra termos e monta trecho destacado', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'O prazo de entrega é de 30 dias corridos.' }]);
    const hits = await searchLike(env.db, {
      workspaceId: owner.workspaceId,
      q: 'prazo entrega',
      limit: 10,
      offset: 0,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain(`${SNIPPET_OPEN}prazo${SNIPPET_CLOSE}`);
    expect(hits[0]!.snippet).toContain(`${SNIPPET_OPEN}entrega${SNIPPET_CLOSE}`);
  });

  it('curingas do LIKE digitados pelo usuário não casam com tudo', async () => {
    const d = await newDoc();
    await extract(d, [{ pageNumber: 1, text: 'desconto de 50% sobre o total geral' }]);
    const wild = await searchLike(env.db, {
      workspaceId: owner.workspaceId,
      q: '%%',
      limit: 5,
      offset: 0,
    });
    expect(wild).toHaveLength(0);
    const ok = await searchLike(env.db, {
      workspaceId: owner.workspaceId,
      q: '50 sobre',
      limit: 5,
      offset: 0,
    });
    expect(ok).toHaveLength(1);
    const miss = await searchLike(env.db, {
      workspaceId: owner.workspaceId,
      q: 'zzz',
      limit: 5,
      offset: 0,
    });
    expect(miss).toHaveLength(0);
  });

  it('buildSnippet reticencia e limita o tamanho', () => {
    const s = buildSnippet(`${'a '.repeat(100)}alvo${' b'.repeat(100)}`, ['alvo']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain(`${SNIPPET_OPEN}alvo${SNIPPET_CLOSE}`);
    expect(s.length).toBeLessThan(170);
  });
});
