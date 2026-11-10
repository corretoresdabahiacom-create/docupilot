/**
 * Análise estruturada (Fase 3). O navegador extrai (D1/D12); aqui o servidor RECONFERE cada campo
 * contra o texto armazenado: o `raw_value` precisa estar exatamente no intervalo informado e o
 * padrão precisa reproduzi-lo. Valor normalizado, confiança e origem são regenerados no servidor.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  annexKeyFromFileName,
  analysisSchema,
  canCompareSimilarity,
  detectDateConflicts,
  detectEmptyRequiredAcroform,
  detectMoneyConflicts,
  hammingDistance,
  isExactDuplicate,
  MAX_SOURCES_PER_FIELD,
  RULES,
  SIMILAR_MAX_DISTANCE,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  verifyCandidate,
  verifyField,
  type Finding,
  type Lang,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import {
  documentHashes,
  documentMetadata,
  documentPages,
  documents,
  documentTasks,
  extractedFields,
  extractionSources,
  usageRecords,
} from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import { loadQuotas } from '../quotas';
import type { AppVariables, Db } from '../types';

export const analysisRoutes = new Hono<{ Variables: AppVariables }>();
analysisRoutes.use('*', requireAuth);

const monthPeriod = () => new Date().toISOString().slice(0, 7);
/** D1 Free: 100 KB por instrução e 50 consultas por invocação. Lotes pequenos via json_each. */
const JSON_CHUNK = 40;
const MAX_FINDINGS = 50;

async function loadDocument(db: Db, workspaceId: string, documentId: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!doc) throw notFound();
  return doc;
}

/** Trecho de ~60 caracteres para cada lado, com o valor marcado. Sempre gerado no servidor. */
export function snippetAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 60);
  const to = Math.min(text.length, end + 60);
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  return `${from > 0 ? '…' : ''}${flat(text.slice(from, start))}${SNIPPET_OPEN}${flat(text.slice(start, end))}${SNIPPET_CLOSE}${flat(text.slice(end, to))}${to < text.length ? '…' : ''}`;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

interface StoredFinding {
  ruleId: string;
  category: string;
  evidence: Array<{ pageNumber: number; snippet: string }>;
  detail: Record<string, string>;
  reportedBy: 'server' | 'client';
}

// ---------- POST: grava a análise ----------

analysisRoutes.post(
  '/:workspaceId/documents/:documentId/analysis',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, analysisSchema);
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    if (!doc.currentVersionId || doc.status !== 'extracted') {
      throw new AppError('CONFLICT', 409, 'O documento ainda não tem texto extraído.');
    }
    const versionId = doc.currentVersionId;

    const quotas = await loadQuotas(db);
    const used = (
      await db
        .select({ amount: usageRecords.amount })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.workspaceId, workspaceId),
            eq(usageRecords.metric, 'analyses'),
            eq(usageRecords.period, monthPeriod()),
          ),
        )
        .limit(1)
    )[0]?.amount;
    if ((used ?? 0) >= quotas.analysesPerMonth) {
      throw new AppError('QUOTA_EXCEEDED', 429, 'Limite mensal de análises atingido.', {
        limit: quotas.analysesPerMonth,
      });
    }

    // texto das páginas citadas (e só delas)
    const pageNumbers = [
      ...new Set([
        ...input.fields.map((f) => f.page_number),
        ...input.candidates.map((x) => x.page_number),
      ]),
    ];
    const pageText = new Map<number, string>();
    for (const part of chunk(pageNumbers, 60)) {
      const rows = await db
        .select({ pageNumber: documentPages.pageNumber, text: documentPages.text })
        .from(documentPages)
        .where(
          and(eq(documentPages.versionId, versionId), inArray(documentPages.pageNumber, part)),
        );
      for (const r of rows) pageText.set(r.pageNumber, r.text);
    }

    // 1) campos: reconferência
    const language = input.language as Lang;
    type Verified = ReturnType<typeof verifyField> & object;
    const verified: Array<{ f: Verified; snippet: string }> = [];
    let rejected = 0;
    for (const sub of input.fields) {
      const text = pageText.get(sub.page_number);
      const f = text === undefined ? null : verifyField(sub, text, doc.id, language);
      if (!f || text === undefined) {
        rejected++;
        continue;
      }
      verified.push({ f, snippet: snippetAround(text, f.text_span_start, f.text_span_end) });
    }
    if (input.fields.length > 0 && verified.length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Nenhum campo enviado confere com o texto do documento.',
      );
    }

    // agrupa ocorrências do mesmo valor em um campo com várias fontes
    interface Group {
      id: string;
      first: Verified;
      sources: Array<{ f: Verified; snippet: string }>;
      occurrences: number;
    }
    const groups = new Map<string, Group>();
    for (const v of verified) {
      const key = `${v.f.field_type}|${v.f.pattern_id}|${v.f.normalized_value}`;
      let g = groups.get(key);
      if (!g) {
        g = { id: crypto.randomUUID(), first: v.f, sources: [], occurrences: 0 };
        groups.set(key, g);
      }
      g.occurrences++;
      if (g.sources.length < MAX_SOURCES_PER_FIELD) g.sources.push(v);
    }

    // 2) inconsistências
    const findings: StoredFinding[] = [];
    const toStored = (
      fd: Finding,
      reportedBy: 'server' | 'client',
      texts: Map<number, string>,
    ): StoredFinding => ({
      ruleId: fd.ruleId,
      category: fd.category,
      detail: fd.detail,
      reportedBy,
      evidence: fd.evidence.map((e) => {
        const t = texts.get(e.pageNumber);
        return {
          pageNumber: e.pageNumber,
          snippet: t && e.end > e.start ? snippetAround(t, e.start, e.end) : '',
        };
      }),
    });
    const labeled = verified.map((v) => v.f);
    for (const fd of [...detectDateConflicts(labeled), ...detectMoneyConflicts(labeled)])
      findings.push(toStored(fd, 'server', pageText));

    // candidatos reconferidos
    const annexMentions = new Map<
      string,
      { page: number; start: number; end: number; raw: string }
    >();
    for (const cand of input.candidates) {
      const text = pageText.get(cand.page_number);
      if (text === undefined) continue;
      const check = verifyCandidate(cand, text);
      if (!check.ok) {
        rejected++;
        continue;
      }
      if (cand.rule === 'annex_mention') {
        if (check.key && !annexMentions.has(check.key))
          annexMentions.set(check.key, {
            page: cand.page_number,
            start: cand.start,
            end: cand.end,
            raw: cand.raw,
          });
      } else {
        findings.push(
          toStored(
            {
              ruleId: 'cpf_cnpj_dv_invalid',
              category: RULES.cpf_cnpj_dv_invalid,
              evidence: [
                { pageNumber: cand.page_number, start: cand.start, end: cand.end, raw: cand.raw },
              ],
              detail: { kind: cand.rule === 'invalid_cpf' ? 'CPF' : 'CNPJ' },
            },
            'server',
            pageText,
          ),
        );
      }
    }
    if (annexMentions.size > 0) {
      const names = await db
        .select({ id: documents.id, name: documents.name })
        .from(documents)
        .where(eq(documents.workspaceId, workspaceId));
      const have = new Set<string>();
      for (const d of names) {
        const k = annexKeyFromFileName(d.name);
        if (k) have.add(k);
      }
      const own = annexKeyFromFileName(doc.name);
      for (const [key, m] of annexMentions) {
        if (have.has(key) || key === own) continue;
        findings.push(
          toStored(
            {
              ruleId: 'missing_annex_reference',
              category: RULES.missing_annex_reference,
              evidence: [{ pageNumber: m.page, start: m.start, end: m.end, raw: m.raw }],
              detail: { annex: m.raw },
            },
            'server',
            pageText,
          ),
        );
      }
    }
    for (const fd of detectEmptyRequiredAcroform(input.acroform))
      findings.push(toStored(fd, 'client', pageText));
    const storedFindings = findings.slice(0, MAX_FINDINGS);

    // 3) escrita atômica
    const now = Date.now();
    const fieldRows = [...groups.values()].map((g) => ({
      id: g.id,
      t: g.first.field_type,
      r: g.first.raw_value,
      n: g.first.normalized_value,
      l: g.first.label ?? null,
      p: g.first.pattern_id,
      c: g.first.confidence,
      k: g.first.source_kind,
    }));
    const sourceRows = [...groups.values()].flatMap((g) =>
      g.sources.map((s) => ({
        id: crypto.randomUUID(),
        f: g.id,
        pg: s.f.page_number,
        a: s.f.text_span_start,
        b: s.f.text_span_end,
        sn: s.snippet,
        p: s.f.pattern_id,
        c: s.f.confidence,
      })),
    );
    const meta = {
      versionId,
      language: input.language,
      analyzedAt: now,
      fields: fieldRows.length,
      occurrences: verified.length,
      sources: sourceRows.length,
      rejected,
      truncated: input.truncated ?? { fields: 0, candidates: 0 },
      hasSimhash: Boolean(input.simhash),
    };
    const taskRows = [
      { id: crypto.randomUUID(), k: 'analysis', p: JSON.stringify(meta) },
      ...storedFindings.map((fd) => ({
        id: crypto.randomUUID(),
        k: 'inconsistency',
        p: JSON.stringify(fd),
      })),
    ];

    const queries: unknown[] = [
      db.delete(extractionSources).where(eq(extractionSources.documentId, doc.id)),
      db.delete(extractedFields).where(eq(extractedFields.documentId, doc.id)),
      db
        .delete(documentTasks)
        .where(
          and(
            eq(documentTasks.documentId, doc.id),
            inArray(documentTasks.kind, ['analysis', 'inconsistency']),
          ),
        ),
    ];
    for (const part of chunk(fieldRows, JSON_CHUNK)) {
      queries.push(
        db.run(sql`
        INSERT INTO extracted_fields
          (id, document_id, workspace_id, field_type, raw_value, normalized_value, label, pattern_id, confidence, source_kind, created_at)
        SELECT json_extract(j.value, '$.id'), ${doc.id}, ${workspaceId}, json_extract(j.value, '$.t'),
               json_extract(j.value, '$.r'), json_extract(j.value, '$.n'), json_extract(j.value, '$.l'),
               json_extract(j.value, '$.p'), json_extract(j.value, '$.c'), json_extract(j.value, '$.k'), ${now}
        FROM json_each(${JSON.stringify(part)}) AS j`),
      );
    }
    for (const part of chunk(sourceRows, JSON_CHUNK)) {
      queries.push(
        db.run(sql`
        INSERT INTO extraction_sources
          (id, extracted_field_id, document_id, page_number, text_span_start, text_span_end, snippet, pattern_id, confidence)
        SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.f'), ${doc.id}, json_extract(j.value, '$.pg'),
               json_extract(j.value, '$.a'), json_extract(j.value, '$.b'), json_extract(j.value, '$.sn'),
               json_extract(j.value, '$.p'), json_extract(j.value, '$.c')
        FROM json_each(${JSON.stringify(part)}) AS j`),
      );
    }
    for (const part of chunk(taskRows, JSON_CHUNK)) {
      queries.push(
        db.run(sql`
        INSERT INTO document_tasks (id, document_id, workspace_id, kind, status, payload, created_at, updated_at)
        SELECT json_extract(j.value, '$.id'), ${doc.id}, ${workspaceId}, json_extract(j.value, '$.k'), 'open',
               json_extract(j.value, '$.p'), ${now}, ${now}
        FROM json_each(${JSON.stringify(part)}) AS j`),
      );
    }
    queries.push(
      db
        .update(documentHashes)
        .set({ simhash: input.simhash ?? null })
        .where(eq(documentHashes.documentVersionId, versionId)),
      db
        .update(documentMetadata)
        .set({ language: input.language === 'und' ? null : input.language, updatedAt: now })
        .where(eq(documentMetadata.documentId, doc.id)),
      db
        .insert(usageRecords)
        .values({ workspaceId, metric: 'analyses', period: monthPeriod(), amount: 1 })
        .onConflictDoUpdate({
          target: [usageRecords.workspaceId, usageRecords.metric, usageRecords.period],
          set: { amount: sql`${usageRecords.amount} + 1` },
        }),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'analysis.saved',
        targetType: 'document',
        targetId: doc.id,
        meta: { fields: fieldRows.length, findings: storedFindings.length, rejected },
      }),
    );
    await runBatch(db, queries);

    return c.json({
      analysis: meta,
      fields: fieldRows.length,
      inconsistencies: storedFindings.length,
      rejected,
    });
  },
);

// ---------- GET: lê a análise + duplicados ----------

analysisRoutes.get(
  '/:workspaceId/documents/:documentId/analysis',
  requireWorkspacePermission('read'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));

    const tasks = await db
      .select()
      .from(documentTasks)
      .where(
        and(
          eq(documentTasks.documentId, doc.id),
          inArray(documentTasks.kind, ['analysis', 'inconsistency']),
        ),
      );
    const metaRow = tasks.find((t) => t.kind === 'analysis');
    const meta = metaRow?.payload ? (JSON.parse(metaRow.payload) as { versionId: string }) : null;
    const fresh = Boolean(meta && meta.versionId === doc.currentVersionId);

    let fields: unknown[] = [];
    let inconsistencies: unknown[] = [];
    if (fresh) {
      const [fieldRows, sourceRows] = await Promise.all([
        db.select().from(extractedFields).where(eq(extractedFields.documentId, doc.id)),
        db.select().from(extractionSources).where(eq(extractionSources.documentId, doc.id)),
      ]);
      const byField = new Map<string, typeof sourceRows>();
      for (const s of sourceRows) {
        const arr = byField.get(s.extractedFieldId) ?? [];
        arr.push(s);
        byField.set(s.extractedFieldId, arr);
      }
      fields = fieldRows
        .map((f) => ({
          id: f.id,
          fieldType: f.fieldType,
          rawValue: f.rawValue,
          normalizedValue: f.normalizedValue,
          label: f.label,
          patternId: f.patternId,
          confidence: f.confidence,
          sourceKind: f.sourceKind,
          sources: (byField.get(f.id) ?? [])
            .sort((a, b) => a.pageNumber - b.pageNumber || a.textSpanStart - b.textSpanStart)
            .map((s) => ({
              pageNumber: s.pageNumber,
              start: s.textSpanStart,
              end: s.textSpanEnd,
              snippet: s.snippet ?? '',
            })),
        }))
        .sort(
          (a, b) =>
            a.fieldType.localeCompare(b.fieldType) ||
            a.normalizedValue.localeCompare(b.normalizedValue),
        );
      inconsistencies = tasks
        .filter((t) => t.kind === 'inconsistency' && t.payload)
        .map((t) => ({ id: t.id, ...(JSON.parse(t.payload as string) as StoredFinding) }));
    }

    // duplicados são calculados na hora (dependem dos outros documentos do workspace)
    const exact: Array<{ documentId: string; name: string }> = [];
    const similar: Array<{ documentId: string; name: string; distance: number }> = [];
    if (doc.currentVersionId) {
      const mine = (
        await db
          .select({ sha256: documentHashes.sha256, simhash: documentHashes.simhash })
          .from(documentHashes)
          .where(eq(documentHashes.documentVersionId, doc.currentVersionId))
          .limit(1)
      )[0];
      if (mine) {
        const others = await db
          .select({
            id: documents.id,
            name: documents.name,
            status: documents.status,
            sha256: documentHashes.sha256,
            simhash: documentHashes.simhash,
          })
          .from(documents)
          .innerJoin(
            documentHashes,
            eq(documentHashes.documentVersionId, documents.currentVersionId),
          )
          .where(and(eq(documents.workspaceId, workspaceId), ne(documents.id, doc.id)));
        const mineComparable = canCompareSimilarity({ status: doc.status, simhash: mine.simhash });
        for (const o of others) {
          if (isExactDuplicate(mine.sha256, o.sha256)) {
            exact.push({ documentId: o.id, name: o.name });
          } else if (
            mineComparable &&
            canCompareSimilarity({ status: o.status, simhash: o.simhash })
          ) {
            const distance = hammingDistance(mine.simhash as string, o.simhash as string);
            if (distance <= SIMILAR_MAX_DISTANCE)
              similar.push({ documentId: o.id, name: o.name, distance });
          }
        }
        similar.sort((a, b) => a.distance - b.distance);
      }
    }

    return c.json({
      status: meta ? (fresh ? 'fresh' : 'stale') : 'none',
      analysis: fresh ? meta : null,
      fields,
      inconsistencies,
      duplicates: { exact, similar, similarThreshold: SIMILAR_MAX_DISTANCE },
    });
  },
);
