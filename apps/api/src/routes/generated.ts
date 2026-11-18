/**
 * Documentos criados no editor (Fase 6, D15). O conteúdo é Tiptap JSON gravado em
 * `generated_documents.content` e SEMPRE revalidado aqui (o navegador não é confiável).
 * Edição concorrente: PUT exige a `version` lida; se mudou, 409 e nada é sobrescrito.
 * As exportações (PDF/DOCX/HTML/MD/TXT) são geradas no navegador; este módulo só autoriza,
 * conta a cota mensal e audita.
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  DOC_EXPORT_FORMATS,
  emptyDoc,
  findPlaceholders,
  getTemplate,
  MAX_TITLE_CHARS,
  parseDoc,
  templateDoc,
  validateDoc,
  type DocRoot,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import { generatedDocuments, usageRecords } from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import { loadQuotas } from '../quotas';
import type { AppVariables } from '../types';

export const MAX_GENERATED_PER_WORKSPACE = 200;

export const generatedRoutes = new Hono<{ Variables: AppVariables }>();
generatedRoutes.use('*', requireAuth);

const title = z.string().trim().min(1).max(MAX_TITLE_CHARS);
const createSchema = z.strictObject({
  title,
  template: z.string().max(30).optional(),
  values: z.record(z.string().max(40), z.string().max(500)).optional(),
  content: z.unknown().optional(),
});
const updateSchema = z.strictObject({
  title,
  content: z.unknown(),
  version: z.number().int().min(1),
});
const exportSchema = z.strictObject({ format: z.enum(DOC_EXPORT_FORMATS) });

const monthPeriod = () => new Date().toISOString().slice(0, 7);

function cleanContent(raw: unknown): DocRoot {
  const r = validateDoc(raw);
  if (!r.ok) throw new AppError('VALIDATION_ERROR', 400, `Conteúdo inválido: ${r.error}.`);
  return r.doc;
}

generatedRoutes.get('/:workspaceId/generated', requireWorkspacePermission('read'), async (c) => {
  const { workspaceId } = c.get('member');
  const rows = await c
    .get('deps')
    .db.select({
      id: generatedDocuments.id,
      title: generatedDocuments.title,
      version: generatedDocuments.version,
      updatedAt: generatedDocuments.updatedAt,
    })
    .from(generatedDocuments)
    .where(eq(generatedDocuments.workspaceId, workspaceId))
    .orderBy(desc(generatedDocuments.updatedAt))
    .limit(MAX_GENERATED_PER_WORKSPACE);
  return c.json({ documents: rows, max: MAX_GENERATED_PER_WORKSPACE });
});

generatedRoutes.post('/:workspaceId/generated', requireWorkspacePermission('edit'), async (c) => {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const user = c.get('user');
  const input = await parseBody(c, createSchema);

  let doc: DocRoot;
  if (input.template !== undefined) {
    if (!getTemplate(input.template))
      throw new AppError('VALIDATION_ERROR', 400, 'Modelo desconhecido.');
    doc = templateDoc(input.template, input.values) ?? emptyDoc();
  } else {
    doc = input.content === undefined ? emptyDoc() : cleanContent(input.content);
  }

  const total = await db
    .select({ n: count() })
    .from(generatedDocuments)
    .where(eq(generatedDocuments.workspaceId, workspaceId));
  if ((total[0]?.n ?? 0) >= MAX_GENERATED_PER_WORKSPACE) {
    throw new AppError(
      'QUOTA_EXCEEDED',
      429,
      `Limite de ${MAX_GENERATED_PER_WORKSPACE} documentos criados.`,
    );
  }
  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(generatedDocuments).values({
      id,
      workspaceId,
      title: input.title,
      content: JSON.stringify(doc),
      createdBy: user.id,
    }),
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'generated.created',
      targetType: 'generated_document',
      targetId: id,
      meta: input.template ? { template: input.template } : {},
    }),
  ]);
  return c.json({ id, version: 1, placeholders: findPlaceholders(doc) }, 201);
});

async function load(
  c: { get: (k: 'deps') => { db: import('../types').Db } },
  workspaceId: string,
  id: string,
) {
  const row = (
    await c
      .get('deps')
      .db.select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!row) throw notFound();
  return row;
}

generatedRoutes.get(
  '/:workspaceId/generated/:id',
  requireWorkspacePermission('read'),
  async (c) => {
    const { workspaceId } = c.get('member');
    const row = await load(c, workspaceId, c.req.param('id'));
    const parsed = parseDoc(row.content);
    if (!parsed.ok) throw new AppError('INTERNAL', 500, 'Documento armazenado ilegível.');
    return c.json({
      id: row.id,
      title: row.title,
      version: row.version,
      updatedAt: row.updatedAt,
      content: parsed.doc,
      placeholders: findPlaceholders(parsed.doc),
    });
  },
);

generatedRoutes.put(
  '/:workspaceId/generated/:id',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const row = await load(c, workspaceId, c.req.param('id'));
    const input = await parseBody(c, updateSchema);
    const doc = cleanContent(input.content);
    // A condição de versão no próprio UPDATE evita sobrescrever uma edição mais nova.
    const updated = await db
      .update(generatedDocuments)
      .set({
        title: input.title,
        content: JSON.stringify(doc),
        version: sql`${generatedDocuments.version} + 1`,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(generatedDocuments.id, row.id),
          eq(generatedDocuments.workspaceId, workspaceId),
          eq(generatedDocuments.version, input.version),
        ),
      )
      .returning({ version: generatedDocuments.version });
    if (updated.length === 0) {
      throw new AppError(
        'CONFLICT',
        409,
        'O documento foi alterado por outra pessoa. Recarregue antes de salvar.',
      );
    }
    await auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'generated.updated',
      targetType: 'generated_document',
      targetId: row.id,
    });
    return c.json({ id: row.id, version: updated[0]?.version ?? input.version + 1 });
  },
);

generatedRoutes.delete(
  '/:workspaceId/generated/:id',
  requireWorkspacePermission('delete'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const row = await load(c, workspaceId, c.req.param('id'));
    await runBatch(db, [
      db.delete(generatedDocuments).where(eq(generatedDocuments.id, row.id)),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: 'generated.deleted',
        targetType: 'generated_document',
        targetId: row.id,
      }),
    ]);
    return c.json({ deleted: true });
  },
);

/** Autoriza e conta uma exportação; o arquivo é gerado no navegador depois do "ok". */
generatedRoutes.post(
  '/:workspaceId/generated/:id/exports',
  requireWorkspacePermission('export'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, exportSchema);
    const row = await load(c, workspaceId, c.req.param('id'));
    const quotas = await loadQuotas(db);
    const period = monthPeriod();
    const used =
      (
        await db
          .select({ amount: usageRecords.amount })
          .from(usageRecords)
          .where(
            and(
              eq(usageRecords.workspaceId, workspaceId),
              eq(usageRecords.metric, 'exports'),
              eq(usageRecords.period, period),
            ),
          )
          .limit(1)
      )[0]?.amount ?? 0;
    if (used >= quotas.exportsPerMonth) {
      throw new AppError('QUOTA_EXCEEDED', 429, 'Limite mensal de exportações atingido.', {
        limit: quotas.exportsPerMonth,
      });
    }
    await runBatch(db, [
      db
        .insert(usageRecords)
        .values({ workspaceId, metric: 'exports', period, amount: 1 })
        .onConflictDoUpdate({
          target: [usageRecords.workspaceId, usageRecords.metric, usageRecords.period],
          set: { amount: sql`${usageRecords.amount} + 1` },
        }),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'generated.exported',
        targetType: 'generated_document',
        targetId: row.id,
        meta: { format: input.format },
      }),
    ]);
    return c.json({ ok: true, used: used + 1, limit: quotas.exportsPerMonth });
  },
);
