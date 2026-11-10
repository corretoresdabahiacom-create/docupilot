import { beforeEach, describe, expect, it } from 'vitest';
import { analyzePages, SNIPPET_CLOSE, SNIPPET_OPEN, simhash64 } from '@docupilot/shared';
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

async function newDoc(
  over: { fileName?: string; documentId?: string; sha?: string; allowDuplicate?: boolean } = {},
) {
  const sha256 = over.sha ?? uniqueSha();
  const bytes = pdfBytes(300 + counter);
  const created = await owner.client.post(`${ws()}/uploads`, {
    fileName: over.fileName ?? `doc-${counter}.pdf`,
    mime: 'application/pdf',
    size: bytes.length,
    sha256,
    documentId: over.documentId,
    allowDuplicate: over.allowDuplicate,
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

type Doc = Awaited<ReturnType<typeof newDoc>>;
type Page = { pageNumber: number; text: string };

async function extract(d: Doc, pages: Page[]) {
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

async function extractedDoc(pages: Page[], over: Parameters<typeof newDoc>[0] = {}) {
  const d = await newDoc(over);
  await extract(d, pages);
  return d;
}

const analysisUrl = (d: Doc) => `${ws()}/documents/${d.documentId}/analysis`;

/** Faz o que o navegador faz: analisa as páginas e envia o resultado. */
function bodyFor(pages: Page[], documentId: string, extra: Record<string, unknown> = {}) {
  const a = analyzePages(pages, documentId);
  return {
    language: a.language,
    simhash: a.simhash,
    fields: a.fields,
    candidates: a.candidates,
    ...extra,
  };
}

const CONTRACT: Page[] = [
  {
    pageNumber: 1,
    text: [
      'CONTRATO DE PRESTAÇÃO DE SERVIÇOS entre as partes, conforme o que foi acordado.',
      'Contratante: Empresa X, CNPJ 11.222.333/0001-81, e-mail financeiro@empresax.com.br.',
      'Responsável: CPF 123.456.789-09, fone (71) 3456-7890.',
      'Vencimento: 10/12/2026. Total: R$ 1.234,56.',
    ].join('\n'),
  },
  {
    pageNumber: 2,
    text: 'Responsável alternativo: CPF 123.456.789-09. Foro da comarca de Salvador. Valor de R$ 50,00.',
  },
];

describe('POST/GET analysis', () => {
  it('grava campos reconferidos, com fontes e trechos', async () => {
    const d = await extractedDoc(CONTRACT);
    const res = await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    expect(res.status).toBe(200);
    expect(res.json.rejected).toBe(0);

    const got = await owner.client.get(analysisUrl(d));
    expect(got.status).toBe(200);
    expect(got.json.status).toBe('fresh');
    const fields = got.json.fields as any[];
    const cpf = fields.find((f) => f.fieldType === 'cpf');
    expect(cpf).toMatchObject({
      normalizedValue: '12345678909',
      patternId: 'cpf_strict',
      confidence: 1,
      sourceKind: 'deterministic',
    });
    // mesmo CPF em 2 páginas = 1 campo com 2 fontes
    expect(cpf.sources.map((s: any) => s.pageNumber)).toEqual([1, 2]);
    expect(cpf.sources[0].snippet).toContain(`${SNIPPET_OPEN}123.456.789-09${SNIPPET_CLOSE}`);
    expect(fields.find((f) => f.fieldType === 'cnpj').normalizedValue).toBe('11222333000181');
    const total = fields.find((f) => f.normalizedValue === '1234.56 BRL');
    expect(total.label).toBe('total');
  });

  it('o span devolvido reproduz o valor no texto da página', async () => {
    const d = await extractedDoc(CONTRACT);
    await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    for (const f of got.json.fields as any[])
      for (const s of f.sources) {
        const text = CONTRACT.find((p) => p.pageNumber === s.pageNumber)!.text;
        expect(text.slice(s.start, s.end)).toBe(f.sources.length ? text.slice(s.start, s.end) : '');
        expect(text.slice(s.start, s.end).length).toBeGreaterThan(0);
      }
  });

  it('reanalisar substitui o resultado anterior (não duplica)', async () => {
    const d = await extractedDoc(CONTRACT);
    await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    const first = (await owner.client.get(analysisUrl(d))).json.fields.length;
    await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    const second = await owner.client.get(analysisUrl(d));
    expect(second.json.fields).toHaveLength(first);
    const rows = await env.db.select().from(schema.extractionSources);
    expect(rows.filter((r) => r.documentId === d.documentId)).toHaveLength(
      (second.json.fields as any[]).reduce((n, f) => n + f.sources.length, 0),
    );
  });

  describe('o servidor não grava o que o texto não sustenta', () => {
    it('descarta campo forjado e informa a contagem', async () => {
      const d = await extractedDoc(CONTRACT);
      const body = bodyFor(CONTRACT, d.documentId);
      body.fields.push(
        {
          pattern_id: 'cpf_strict',
          page_number: 1,
          span_start: 0,
          span_end: 14,
          raw_value: '999.999.999-99',
        },
        {
          pattern_id: 'cpf_strict',
          page_number: 9,
          span_start: 0,
          span_end: 14,
          raw_value: '123.456.789-09',
        },
        { pattern_id: 'inventado', page_number: 1, span_start: 0, span_end: 5, raw_value: 'CONTR' },
      );
      const res = await owner.client.post(analysisUrl(d), body);
      expect(res.status).toBe(200);
      expect(res.json.rejected).toBe(3);
      const rows = await env.db.select().from(schema.extractedFields);
      expect(rows.some((r) => r.normalizedValue === '99999999999')).toBe(false);
    });

    it('recusa quando NADA confere', async () => {
      const d = await extractedDoc(CONTRACT);
      const res = await owner.client.post(analysisUrl(d), {
        language: 'pt',
        fields: [
          {
            pattern_id: 'cpf_strict',
            page_number: 1,
            span_start: 0,
            span_end: 14,
            raw_value: '123.456.789-09',
          },
        ],
        candidates: [],
      });
      expect(res.status).toBe(400);
      expect(await env.db.select().from(schema.extractedFields)).toHaveLength(0);
    });

    it('ignora confiança/valor normalizado enviados pelo cliente', async () => {
      const d = await extractedDoc(CONTRACT);
      const body = bodyFor(CONTRACT, d.documentId);
      const res = await owner.client.post(analysisUrl(d), {
        ...body,
        fields: body.fields.map((f) => ({
          ...f,
          confidence: 0.01,
          normalized_value: 'x',
          source_kind: 'ocr',
        })),
      });
      expect(res.status).toBe(200);
      const rows = await env.db.select().from(schema.extractedFields);
      expect(rows.every((r) => r.confidence >= 0.5)).toBe(true);
      expect(rows.every((r) => r.normalizedValue !== 'x' && r.sourceKind !== 'ocr')).toBe(true);
    });

    it('rejeita carga acima do limite de ocorrências', async () => {
      const d = await extractedDoc(CONTRACT);
      const f = bodyFor(CONTRACT, d.documentId).fields[0]!;
      const res = await owner.client.post(analysisUrl(d), {
        language: 'pt',
        fields: Array(401).fill(f),
        candidates: [],
      });
      expect(res.status).toBe(400);
    });
  });

  it('aceita o volume máximo (400 ocorrências) dentro de poucas instruções', async () => {
    const text = Array.from({ length: 400 }, (_, i) => `Item ${i}: R$ ${i + 1},00`).join('\n');
    const pages = [{ pageNumber: 1, text }];
    const d = await extractedDoc(pages);
    const res = await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    expect(res.status).toBe(200);
    expect(res.json.fields).toBe(400);
    expect(res.json.rejected).toBe(0);
  });

  it('exige texto extraído', async () => {
    const d = await newDoc();
    const res = await owner.client.post(analysisUrl(d), {
      language: 'pt',
      fields: [],
      candidates: [],
    });
    expect(res.status).toBe(409);
  });

  it('a análise fica "desatualizada" quando a versão atual muda', async () => {
    const d = await extractedDoc(CONTRACT);
    await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    const v2 = await newDoc({ documentId: d.documentId });
    expect(v2.documentId).toBe(d.documentId);
    const got = await owner.client.get(analysisUrl(d));
    expect(got.json.status).toBe('stale');
    expect(got.json.fields).toEqual([]);
    expect(got.json.inconsistencies).toEqual([]);
  });

  it('sem análise o status é "none"', async () => {
    const d = await extractedDoc(CONTRACT);
    const got = await owner.client.get(analysisUrl(d));
    expect(got.json.status).toBe('none');
  });
});

describe('inconsistências por regra', () => {
  it('E2E: datas diferentes para "Vencimento" viram erro confirmado por regra, com página e trecho', async () => {
    const pages = [
      {
        pageNumber: 1,
        text: 'Contrato de locação.\nVencimento: 10/12/2026 para o primeiro pagamento.',
      },
      { pageNumber: 2, text: 'Cláusula final.\nVencimento: 15/12/2026 conforme anexo.' },
    ];
    const d = await extractedDoc(pages);
    const res = await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    expect(res.json.inconsistencies).toBe(1);
    const got = await owner.client.get(analysisUrl(d));
    const item = (got.json.inconsistencies as any[])[0];
    expect(item).toMatchObject({
      ruleId: 'date_conflict_same_label',
      category: 'erro_confirmado_por_regra',
      detail: { label: 'vencimento', values: '2026-12-10 | 2026-12-15' },
    });
    expect(item.evidence).toHaveLength(2);
    expect(item.evidence[0].pageNumber).toBe(1);
    expect(item.evidence[0].snippet).toContain(`${SNIPPET_OPEN}10/12/2026${SNIPPET_CLOSE}`);
    expect(item.evidence[1].pageNumber).toBe(2);
  });

  it('valores divergentes para "Total"', async () => {
    const pages = [
      { pageNumber: 1, text: 'Total: R$ 1.000,00\nResumo do pedido\nTotal: R$ 1.200,00' },
    ];
    const d = await extractedDoc(pages);
    await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    expect((got.json.inconsistencies as any[]).map((i) => i.ruleId)).toEqual([
      'money_conflict_same_label',
    ]);
  });

  it('o mesmo valor repetido NÃO é inconsistência', async () => {
    const pages = [{ pageNumber: 1, text: 'Total: R$ 1.000,00\nTotal: R$ 1.000,00' }];
    const d = await extractedDoc(pages);
    await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    expect(got.json.inconsistencies).toEqual([]);
  });

  it('CPF com DV inválido vira inconsistência e NÃO vira campo extraído', async () => {
    const pages = [
      { pageNumber: 1, text: 'O contratante, CPF: 123.456.789-10, assina o presente.' },
    ];
    const d = await extractedDoc(pages);
    await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    expect((got.json.inconsistencies as any[])[0]).toMatchObject({
      ruleId: 'cpf_cnpj_dv_invalid',
      category: 'erro_confirmado_por_regra',
      detail: { kind: 'CPF' },
    });
    expect((got.json.fields as any[]).some((f) => f.fieldType === 'cpf')).toBe(false);
  });

  it('candidato forjado é descartado', async () => {
    const pages = [
      { pageNumber: 1, text: 'O contratante, CPF: 123.456.789-09, assina o presente.' },
    ];
    const d = await extractedDoc(pages);
    const res = await owner.client.post(analysisUrl(d), {
      ...bodyFor(pages, d.documentId),
      candidates: [
        { rule: 'invalid_cpf', page_number: 1, start: 20, end: 34, raw: '123.456.789-09' },
      ],
    });
    expect(res.json.rejected).toBe(1);
    expect(res.json.inconsistencies).toBe(0);
  });

  it('anexo mencionado sem arquivo no workspace exige revisão humana; com arquivo não', async () => {
    const pages = [
      { pageNumber: 1, text: 'Conforme o Anexo I e o Anexo II deste contrato, as partes acordam.' },
    ];
    await newDoc({ fileName: 'Anexo I - Planilha de preços.pdf' });
    const d = await extractedDoc(pages, { fileName: 'Contrato.pdf' });
    await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    const items = got.json.inconsistencies as any[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ruleId: 'missing_annex_reference',
      category: 'exige_revisao_humana',
      detail: { annex: 'Anexo II' },
    });
  });

  it('o próprio documento é o anexo mencionado: não é "ausente"', async () => {
    const pages = [
      {
        pageNumber: 1,
        text: 'ANEXO I\nTabela de preços que integra o contrato principal das partes.',
      },
    ];
    const d = await extractedDoc(pages, { fileName: 'Anexo I.pdf' });
    await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
    const got = await owner.client.get(analysisUrl(d));
    expect(got.json.inconsistencies).toEqual([]);
  });

  it('AcroForm: campo obrigatório vazio é registrado como informado pelo navegador', async () => {
    const d = await extractedDoc(CONTRACT);
    await owner.client.post(
      analysisUrl(d),
      bodyFor(CONTRACT, d.documentId, {
        acroform: [
          { pageNumber: 1, name: 'nome_completo', required: true, filled: false },
          { pageNumber: 1, name: 'cpf', required: true, filled: true },
        ],
      }),
    );
    const got = await owner.client.get(analysisUrl(d));
    const item = (got.json.inconsistencies as any[]).find(
      (i) => i.ruleId === 'empty_required_acroform',
    );
    expect(item).toMatchObject({
      category: 'erro_confirmado_por_regra',
      reportedBy: 'client',
      detail: { name: 'nome_completo' },
    });
  });
});

describe('duplicados', () => {
  const longText = (seed: string) =>
    Array.from({ length: 300 }, (_, i) => `${seed}${(i * 7919) % 613}`).join(' ');

  it('SHA-256 igual = duplicado exato (e nunca "similar")', async () => {
    const sha = uniqueSha();
    const a = await extractedDoc(CONTRACT, { sha, fileName: 'a.pdf' });
    await extractedDoc(CONTRACT, { sha, allowDuplicate: true, fileName: 'b.pdf' });
    const got = await owner.client.get(analysisUrl(a));
    expect(got.json.duplicates.exact.map((x: any) => x.name)).toEqual(['b.pdf']);
    expect(got.json.duplicates.similar).toEqual([]);
  });

  it('SimHash com distância ≤ 6 = possivelmente similar; texto distinto não', async () => {
    const base = longText('alfa');
    const edited = base.replace('alfa7919', 'alfa-editado').replace('alfa5', 'alfa-x');
    const other = longText('beta');
    const mk = async (text: string, name: string) => {
      const pages = [{ pageNumber: 1, text }];
      const d = await extractedDoc(pages, { fileName: name });
      await owner.client.post(analysisUrl(d), bodyFor(pages, d.documentId));
      return d;
    };
    const a = await mk(base, 'a.pdf');
    await mk(edited, 'b.pdf');
    await mk(other, 'c.pdf');
    expect(simhash64(base)).not.toBeNull();
    const got = await owner.client.get(analysisUrl(a));
    expect(got.json.duplicates.similar.map((x: any) => x.name)).toEqual(['b.pdf']);
    expect(got.json.duplicates.similar[0].distance).toBeLessThanOrEqual(6);
    expect(got.json.duplicates.similarThreshold).toBe(6);
  });

  it('documento sem texto extraído só participa do dedup exato', async () => {
    const pages = [{ pageNumber: 1, text: longText('alfa') }];
    const a = await extractedDoc(pages, { fileName: 'a.pdf' });
    await owner.client.post(analysisUrl(a), bodyFor(pages, a.documentId));
    await newDoc({ fileName: 'sem-texto.pdf' });
    const got = await owner.client.get(analysisUrl(a));
    expect(got.json.duplicates.similar).toEqual([]);
  });

  it('não vaza documentos de outro workspace', async () => {
    const other = await registerUser(env, 'other@example.com');
    const sha = uniqueSha();
    const a = await extractedDoc(CONTRACT, { sha });
    const bytes = pdfBytes(300 + counter);
    const c = await other.client.post(`/api/workspaces/${other.workspaceId}/uploads`, {
      fileName: 'estranho.pdf',
      mime: 'application/pdf',
      size: bytes.length,
      sha256: sha,
    });
    env.storage!.put(`ws/${other.workspaceId}/${c.json.uploadId}`, bytes);
    await other.client.post(
      `/api/workspaces/${other.workspaceId}/uploads/${c.json.uploadId}/complete`,
    );
    const got = await owner.client.get(analysisUrl(a));
    expect(got.json.duplicates.exact).toEqual([]);
  });
});

describe('permissões e quota', () => {
  it('viewer lê mas não grava; não-membro recebe 404', async () => {
    const d = await extractedDoc(CONTRACT);
    const viewer = await registerUser(env, 'viewer@example.com');
    await addMember(env, owner.workspaceId, viewer.userId, 'viewer');
    expect((await viewer.client.get(analysisUrl(d))).status).toBe(200);
    expect((await viewer.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId))).status).toBe(
      403,
    );
    const stranger = await registerUser(env, 'stranger@example.com');
    expect((await stranger.client.get(analysisUrl(d))).status).toBe(404);
    expect(
      (await stranger.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId))).status,
    ).toBe(404);
  });

  it('exige sessão', async () => {
    const d = await extractedDoc(CONTRACT);
    const anon = new Client(env);
    expect((await anon.get(analysisUrl(d))).status).toBe(401);
  });

  it('quota mensal de análises', async () => {
    await setSetting(env, 'quota.analysesPerMonth', '1');
    const d = await extractedDoc(CONTRACT);
    expect((await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId))).status).toBe(
      200,
    );
    const second = await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    expect(second.status).toBe(429);
    expect(second.json.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('excluir o documento apaga campos, fontes e achados', async () => {
    const d = await extractedDoc(CONTRACT);
    await owner.client.post(analysisUrl(d), bodyFor(CONTRACT, d.documentId));
    const del = await owner.client.request('DELETE', `${ws()}/documents/${d.documentId}`);
    expect(del.status).toBe(200);
    expect(
      await env.db
        .select()
        .from(schema.extractedFields)
        .where(eq(schema.extractedFields.documentId, d.documentId)),
    ).toHaveLength(0);
    expect(
      await env.db
        .select()
        .from(schema.extractionSources)
        .where(eq(schema.extractionSources.documentId, d.documentId)),
    ).toHaveLength(0);
    expect(
      await env.db
        .select()
        .from(schema.documentTasks)
        .where(eq(schema.documentTasks.documentId, d.documentId)),
    ).toHaveLength(0);
  });
});

describe('busca no documento', () => {
  it('restringe ao documento pedido', async () => {
    const pages = [
      { pageNumber: 1, text: 'cláusula de rescisão antecipada do contrato de locação' },
    ];
    const a = await extractedDoc(pages, { fileName: 'a.pdf' });
    await extractedDoc(pages, { fileName: 'b.pdf' });
    const all = await owner.client.get(`${ws()}/search?q=rescisão`);
    expect(all.json.results).toHaveLength(2);
    const one = await owner.client.get(`${ws()}/search?q=rescisão&documentId=${a.documentId}`);
    expect(one.json.results).toHaveLength(1);
    expect(one.json.results[0].documentName).toBe('a.pdf');
    expect(one.json.results[0].snippet).toContain(SNIPPET_OPEN);
  });
});
