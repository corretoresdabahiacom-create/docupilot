/**
 * E2E da comparação (Fase 4): envio de duas versões pela API, leitura do texto armazenado pela
 * rota de páginas (como faz o navegador) e comparação com o motor de `@docupilot/shared`.
 * A comparação em si não tem rota: roda no navegador e não grava nada.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  compare,
  comparisonRows,
  toCsv,
  type ComparisonResult,
  type PageText,
} from '@docupilot/shared';
import {
  addMember,
  createTestEnv,
  pdfBytes,
  registerUser,
  schema,
  type TestEnv,
} from '../test/helpers';

let env: TestEnv;
let owner: Awaited<ReturnType<typeof registerUser>>;
let counter = 0;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'owner@example.com');
  counter = 0;
});

const ws = () => `/api/workspaces/${owner.workspaceId}`;

async function upload(over: { documentId?: string; fileName?: string } = {}) {
  counter++;
  const bytes = pdfBytes(300 + counter);
  const created = await owner.client.post(`${ws()}/uploads`, {
    fileName: over.fileName ?? `doc-${counter}.pdf`,
    mime: 'application/pdf',
    size: bytes.length,
    sha256: counter.toString(16).padStart(64, '0'),
    documentId: over.documentId,
  });
  expect(created.status).toBe(201);
  const uploadId = created.json.uploadId as string;
  env.storage!.put(`ws/${owner.workspaceId}/${uploadId}`, bytes);
  const done = await owner.client.post(`${ws()}/uploads/${uploadId}/complete`);
  expect(done.status).toBe(201);
  return {
    documentId: done.json.document.id as string,
    versionId: done.json.versionId as string,
  };
}
type Doc = Awaited<ReturnType<typeof upload>>;

async function extract(d: Doc, pages: PageText[]) {
  const put = await owner.client.request(
    'PUT',
    `${ws()}/documents/${d.documentId}/versions/${d.versionId}/pages`,
    { pages, extractedBy: 'client' },
  );
  expect(put.status).toBe(200);
  const done = await owner.client.post(
    `${ws()}/documents/${d.documentId}/versions/${d.versionId}/extraction/complete`,
    { status: 'extracted', pageCount: pages.length, extractedBy: 'client' },
  );
  expect(done.status).toBe(200);
}

/** O que `fetchAllPages` faz no navegador: lê o texto armazenado, 10 páginas por vez. */
async function fetchPages(d: Doc, client = owner.client): Promise<PageText[]> {
  const out: PageText[] = [];
  let from = 1;
  for (let guard = 0; guard < 40; guard++) {
    const res = await client.get(
      `${ws()}/documents/${d.documentId}/pages?from=${from}&versionId=${d.versionId}`,
    );
    expect(res.status).toBe(200);
    out.push(...res.json.pages);
    if (!res.json.hasMore) break;
    from = res.json.pages.at(-1).pageNumber + 1;
  }
  return out;
}

const V1: PageText[] = [
  {
    pageNumber: 1,
    text: [
      'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      '1. Objeto',
      'Prestação de serviços de limpeza.',
      '2. Preço',
      'Valor total: R$ 1.000,00',
      'Vencimento: 10/05/2026',
    ].join('\n'),
  },
  { pageNumber: 2, text: '3. Rescisão\nAviso prévio de 30 dias.\nResponsável CPF 111.444.777-35' },
];
const V2: PageText[] = [
  {
    pageNumber: 1,
    text: [
      'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      '1. Objeto',
      'Prestação de serviços de limpeza.',
      '2. Preço',
      'Valor total: R$ 1.250,00',
      'Vencimento: 15/06/2026',
    ].join('\n'),
  },
  {
    pageNumber: 2,
    text: '3. Rescisão\nAviso prévio de 45 dias.\nResponsável CPF 529.982.247-25\n4. Foro\nComarca de Salvador.',
  },
];

describe('comparação entre versões do mesmo documento', () => {
  async function twoVersions() {
    const v1 = await upload({ fileName: 'contrato.pdf' });
    await extract(v1, V1);
    const v2 = await upload({ documentId: v1.documentId });
    await extract(v2, V2);
    return { v1, v2 };
  }

  it('a versão antiga continua legível depois que a nova vira a atual', async () => {
    const { v1, v2 } = await twoVersions();
    expect(v2.documentId).toBe(v1.documentId);
    expect(v2.versionId).not.toBe(v1.versionId);
    expect((await fetchPages(v1)).map((p) => p.text)).toEqual(V1.map((p) => p.text));
    expect((await fetchPages(v2)).map((p) => p.text)).toEqual(V2.map((p) => p.text));
  });

  let result: ComparisonResult;

  it('diff de texto, de campos (com origem nos dois lados) e de cláusulas', async () => {
    const { v1, v2 } = await twoVersions();
    result = compare(await fetchPages(v1), await fetchPages(v2));

    // texto
    expect(result.text.stats.added).toBeGreaterThanOrEqual(2);
    expect(result.text.stats.changed).toBeGreaterThanOrEqual(3);
    const changed = result.text.hunks.find((h) => h.kind === 'changed' && h.a[0]?.pageNumber === 2);
    expect(changed).toBeDefined();

    // campos: valor A vs B, com página e trecho nos dois lados
    const venc = result.fields.find((f) => f.fieldType === 'date' && f.label === 'vencimento');
    expect(venc?.status).toBe('alterado');
    expect(venc?.a).toMatchObject({ normalized: '2026-05-10' });
    expect(venc?.b).toMatchObject({ normalized: '2026-06-15' });
    expect(venc?.a?.sources[0]).toMatchObject({ pageNumber: 1 });
    expect(venc?.b?.sources[0]?.context.match).toBe('15/06/2026');
    const money = result.fields.find((f) => f.fieldType === 'money');
    expect(money).toMatchObject({ status: 'alterado' });
    expect(money?.a?.normalized).toBe('1000.00 BRL');
    expect(money?.b?.normalized).toBe('1250.00 BRL');
    const cpfs = result.fields.filter((f) => f.fieldType === 'cpf').map((f) => f.status);
    expect(cpfs.sort()).toEqual(['somente_a', 'somente_b']);

    // cláusulas
    expect(result.clauses.stats).toMatchObject({ igual: 1, alterada: 2, adicionada: 1 });
    const rescisao = result.clauses.clauses.find((c) => c.keyB === '3');
    expect(rescisao?.status).toBe('alterada');
    expect(rescisao?.b?.pageNumber).toBe(2);
    const removed = rescisao?.inline?.filter((p) => p.kind === 'removed').map((p) => p.text.trim());
    // a cláusula 3 também troca o CPF do responsável; o prazo antigo aparece entre as removidas
    expect(removed).toContain('30');
    expect(rescisao?.inline?.some((p) => p.kind === 'added' && p.text.includes('45'))).toBe(true);
  });

  it('exporta CSV com os valores dos dois lados e as origens', async () => {
    const { v1, v2 } = await twoVersions();
    const r = compare(await fetchPages(v1), await fetchPages(v2));
    const csv = toCsv(comparisonRows(r));
    expect(csv).toContain('"date — vencimento","alterado","2026-05-10","p.1","2026-06-15","p.1"');
    expect(csv).toContain('"clausula"');
  });

  it('versão sem texto extraído devolve lista vazia (a tela avisa)', async () => {
    const v1 = await upload();
    expect(await fetchPages(v1)).toEqual([]);
  });
});

describe('comparação entre documentos e isolamento', () => {
  it('compara dois documentos diferentes', async () => {
    const a = await upload({ fileName: 'a.pdf' });
    const b = await upload({ fileName: 'b.pdf' });
    await extract(a, V1);
    await extract(b, V2);
    const r = compare(await fetchPages(a), await fetchPages(b));
    expect(r.fields.some((f) => f.status === 'alterado')).toBe(true);
    expect(r.text.similarity).toBeLessThan(1);
  });

  it('viewer lê as páginas; não-membro recebe 404', async () => {
    const a = await upload();
    await extract(a, V1);
    const viewer = await registerUser(env, 'viewer@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    expect((await fetchPages(a, viewer.client)).length).toBe(2);

    const stranger = await registerUser(env, 'stranger@example.com');
    const res = await stranger.client.get(
      `${ws()}/documents/${a.documentId}/pages?versionId=${a.versionId}`,
    );
    expect(res.status).toBe(404);
  });

  it('versionId de outro documento não vaza texto', async () => {
    const a = await upload();
    const b = await upload();
    await extract(a, V1);
    await extract(b, V2);
    const res = await owner.client.get(
      `${ws()}/documents/${a.documentId}/pages?versionId=${b.versionId}`,
    );
    expect(res.status).toBe(404);
  });

  it('a comparação não grava nada no servidor', async () => {
    const a = await upload();
    const b = await upload();
    await extract(a, V1);
    await extract(b, V2);
    const before = {
      fields: (await env.db.select().from(schema.extractedFields)).length,
      tasks: (await env.db.select().from(schema.documentTasks)).length,
      comparisons: (await env.db.select().from(schema.documentComparisons)).length,
    };
    compare(await fetchPages(a), await fetchPages(b));
    const after = {
      fields: (await env.db.select().from(schema.extractedFields)).length,
      tasks: (await env.db.select().from(schema.documentTasks)).length,
      comparisons: (await env.db.select().from(schema.documentComparisons)).length,
    };
    expect(after).toEqual(before);
  });
});
