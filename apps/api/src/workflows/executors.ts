/**
 * Executores dos passos (D15). Todos leves: só leem a análise JÁ GRAVADA (Fase 3) e escrevem no
 * máximo um documento criado. Nada sai do DocuPilot: sem e-mail, webhook, assinatura ou protocolo.
 * Erro inesperado (ex.: banco) vira `RetryableError`; falha de regra vira `fail` e não é repetida.
 */
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  applyValues,
  compareFieldSets,
  getTemplate,
  missingTypes,
  pickFieldValue,
  RetryableError,
  type FieldLike,
  type StepExecutor,
} from '@docupilot/shared';
import { MAX_GENERATED_PER_WORKSPACE } from '../routes/generated';
import { documents, documentTasks, extractedFields, generatedDocuments } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';

export type Inputs = { primary?: string; secondary?: string };
const MAX_FIELDS_PER_DOC = 300;

interface Ctx {
  fields?: { primary?: FieldLike[]; secondary?: FieldLike[] };
  inconsistencies?: { primary?: number; secondary?: number };
  compare?: unknown;
  generatedId?: string;
  unresolved?: Array<{ placeholder: string; reason: string }>;
}

export function makeExecutor(opts: {
  db: Db;
  workspaceId: string;
  userId: string;
  inputs: Inputs;
}): StepExecutor {
  const { db, workspaceId, userId, inputs } = opts;

  return async (step, rawCtx) => {
    const ctx = rawCtx as Ctx;
    try {
      switch (step.kind) {
        case 'input_extract': {
          const which = (step.config as { input: 'primary' | 'secondary' }).input;
          const documentId = inputs[which];
          if (!documentId) return { kind: 'fail', error: `entrada "${which}" não informada` };
          const doc = (
            await db
              .select()
              .from(documents)
              .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
              .limit(1)
          )[0];
          if (!doc)
            return { kind: 'fail', error: `documento da entrada "${which}" não encontrado` };
          const tasks = await db
            .select()
            .from(documentTasks)
            .where(
              and(
                eq(documentTasks.documentId, doc.id),
                inArray(documentTasks.kind, ['analysis', 'inconsistency']),
              ),
            );
          const meta = tasks.find((t) => t.kind === 'analysis');
          const versionId = meta?.payload
            ? (JSON.parse(meta.payload) as { versionId?: string }).versionId
            : null;
          if (!meta || versionId !== doc.currentVersionId) {
            return {
              kind: 'fail',
              error: `o documento da entrada "${which}" não tem análise atualizada; analise-o antes`,
            };
          }
          const rows = await db
            .select({
              fieldType: extractedFields.fieldType,
              normalizedValue: extractedFields.normalizedValue,
              label: extractedFields.label,
            })
            .from(extractedFields)
            .where(eq(extractedFields.documentId, doc.id))
            .limit(MAX_FIELDS_PER_DOC);
          const inconsistencies = tasks.filter((t) => t.kind === 'inconsistency').length;
          return {
            kind: 'done',
            result: { input: which, fields: rows.length, inconsistencies },
            ctx: {
              fields: { ...ctx.fields, [which]: rows },
              inconsistencies: { ...ctx.inconsistencies, [which]: inconsistencies },
            },
          };
        }

        case 'validate': {
          const cfg = step.config as { requiredTypes: string[]; failOnInconsistency: boolean };
          const missing = missingTypes(ctx.fields?.primary ?? [], cfg.requiredTypes);
          const incons = Object.values(ctx.inconsistencies ?? {}).reduce((a, b) => a + (b ?? 0), 0);
          if (missing.length)
            return { kind: 'fail', error: `campos ausentes: ${missing.join(', ')}` };
          if (cfg.failOnInconsistency && incons > 0) {
            return { kind: 'fail', error: `${incons} inconsistência(s) apontada(s) na análise` };
          }
          return { kind: 'done', result: { missing: [], inconsistencies: incons } };
        }

        case 'compare': {
          const cmp = compareFieldSets(ctx.fields?.primary ?? [], ctx.fields?.secondary ?? []);
          return {
            kind: 'done',
            result: { equal: cmp.equal, changed: cmp.changed, onlyA: cmp.onlyA, onlyB: cmp.onlyB },
            ctx: { compare: cmp },
          };
        }

        case 'generate': {
          const cfg = step.config as {
            templateKey: string;
            title: string;
            mapping: Record<string, { fieldType: string; label?: string }>;
          };
          const tpl = getTemplate(cfg.templateKey);
          if (!tpl) return { kind: 'fail', error: 'modelo desconhecido' };
          const values: Record<string, string> = {};
          const unresolved: Array<{ placeholder: string; reason: string }> = [];
          for (const [ph, m] of Object.entries(cfg.mapping)) {
            const pick = pickFieldValue(ctx.fields?.primary ?? [], m);
            if (pick.value === null) unresolved.push({ placeholder: ph, reason: pick.reason });
            else values[ph] = pick.value;
          }
          const total = await db
            .select({ n: count() })
            .from(generatedDocuments)
            .where(eq(generatedDocuments.workspaceId, workspaceId));
          if ((total[0]?.n ?? 0) >= MAX_GENERATED_PER_WORKSPACE) {
            return { kind: 'fail', error: 'limite de documentos criados atingido' };
          }
          const id = crypto.randomUUID();
          await db.insert(generatedDocuments).values({
            id,
            workspaceId,
            title: cfg.title,
            content: JSON.stringify(applyValues(tpl.doc, values)),
            createdBy: userId,
          });
          return {
            kind: 'done',
            result: { generatedId: id, filled: Object.keys(values).length, unresolved },
            ctx: { generatedId: id, unresolved },
          };
        }

        case 'approval':
          return { kind: 'pause', result: { waiting: true } };

        case 'output':
          return {
            kind: 'done',
            result: {
              generatedId: ctx.generatedId ?? null,
              compared: Boolean(ctx.compare),
              unresolved: ctx.unresolved?.length ?? 0,
            },
          };
      }
    } catch (err) {
      if (err instanceof AppError) return { kind: 'fail', error: err.message };
      throw new RetryableError(err instanceof Error ? err.message : 'erro transitório');
    }
  };
}
