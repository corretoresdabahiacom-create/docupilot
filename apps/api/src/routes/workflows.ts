/**
 * Workflows lineares (Fase 6, D15). A execução roda aqui, passo a passo, e é gravada em
 * `workflow_executions.step_log` (JSON com os passos "congelados", entradas, contexto enquanto
 * pausada e o log de cada passo). A aprovação pausa a execução; quem decide é outra rota.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  can,
  isRole,
  MAX_WORKFLOWS_PER_WORKSPACE,
  requiredInputs,
  runWorkflow,
  stepSchema,
  validateStepOrder,
  workflowInputSchema,
  type ExecutionStatus,
  type StepLogEntry,
  type WorkflowStep,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import {
  approvals,
  documents,
  notifications,
  workflowDefinitions,
  workflowExecutions,
  workflowSteps,
  workspaceMembers,
} from '../db/schema';
import { assertFolderAccess } from '../access';
import { AppError, forbidden, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import type { AppVariables, Db } from '../types';
import { makeExecutor, type Inputs } from '../workflows/executors';

export const workflowRoutes = new Hono<{ Variables: AppVariables }>();
workflowRoutes.use('*', requireAuth);

/** Limites do motor; testes podem reduzi-los pelo `deps.config.workflowLimits`. */
type Limits = { stepTimeoutMs?: number; totalTimeoutMs?: number; maxRetries?: number };

interface State {
  v: 1;
  steps: WorkflowStep[];
  inputs: Inputs;
  startedBy: string;
  ctx: Record<string, unknown> | null;
  entries: StepLogEntry[];
  nextIndex: number;
  usedMs: number;
}

// ---------- definições ----------

function checkDefinition(raw: unknown) {
  const parsed = workflowInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(corpo)'))];
    throw new AppError('VALIDATION_ERROR', 400, `Dados inválidos: ${fields.join(', ')}.`);
  }
  const order = validateStepOrder(parsed.data.steps);
  if (order) throw new AppError('VALIDATION_ERROR', 400, `Fluxo inválido: ${order}.`);
  return parsed.data;
}

async function loadDefinition(db: Db, workspaceId: string, id: string) {
  const def = (
    await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!def) throw notFound();
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, def.id))
    .orderBy(workflowSteps.position);
  return {
    def,
    steps: steps.map((s) =>
      stepSchema.parse({ kind: s.kind, config: s.config ? JSON.parse(s.config) : {} }),
    ),
  };
}

workflowRoutes.get('/:workspaceId/workflows', requireWorkspacePermission('read'), async (c) => {
  const { workspaceId } = c.get('member');
  const { db } = c.get('deps');
  const rows = await db
    .select({
      id: workflowDefinitions.id,
      name: workflowDefinitions.name,
      updatedAt: workflowDefinitions.updatedAt,
    })
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.workspaceId, workspaceId))
    .orderBy(desc(workflowDefinitions.updatedAt))
    .limit(MAX_WORKFLOWS_PER_WORKSPACE);
  const counts = rows.length
    ? await db
        .select({ id: workflowSteps.workflowId, n: sql<number>`count(*)` })
        .from(workflowSteps)
        .where(
          inArray(
            workflowSteps.workflowId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(workflowSteps.workflowId)
    : [];
  const byId = new Map(counts.map((x) => [x.id, Number(x.n)]));
  return c.json({
    workflows: rows.map((r) => ({ ...r, steps: byId.get(r.id) ?? 0 })),
    max: MAX_WORKFLOWS_PER_WORKSPACE,
  });
});

const stepRows = (workflowId: string, steps: WorkflowStep[]) =>
  steps.map((s, i) => ({
    workflowId,
    position: i + 1,
    kind: s.kind,
    config: JSON.stringify(s.config),
  }));

workflowRoutes.post('/:workspaceId/workflows', requireWorkspacePermission('edit'), async (c) => {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const user = c.get('user');
  const raw = await c.req.json().catch(() => null);
  const input = checkDefinition(raw);
  const total = (
    await db
      .select({ n: sql<number>`count(*)` })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.workspaceId, workspaceId))
  )[0]?.n;
  if (Number(total ?? 0) >= MAX_WORKFLOWS_PER_WORKSPACE) {
    throw new AppError(
      'QUOTA_EXCEEDED',
      429,
      `Limite de ${MAX_WORKFLOWS_PER_WORKSPACE} workflows.`,
    );
  }
  const id = crypto.randomUUID();
  await runBatch(db, [
    db
      .insert(workflowDefinitions)
      .values({ id, workspaceId, name: input.name, createdBy: user.id }),
    db.insert(workflowSteps).values(stepRows(id, input.steps)),
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'workflow.created',
      targetType: 'workflow',
      targetId: id,
      meta: { steps: input.steps.length },
    }),
  ]);
  return c.json({ id }, 201);
});

workflowRoutes.get('/:workspaceId/workflows/:id', requireWorkspacePermission('read'), async (c) => {
  const { workspaceId } = c.get('member');
  const { def, steps } = await loadDefinition(c.get('deps').db, workspaceId, c.req.param('id'));
  return c.json({
    id: def.id,
    name: def.name,
    updatedAt: def.updatedAt,
    steps,
    inputs: requiredInputs(steps),
  });
});

workflowRoutes.put('/:workspaceId/workflows/:id', requireWorkspacePermission('edit'), async (c) => {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const { def } = await loadDefinition(db, workspaceId, c.req.param('id'));
  const input = checkDefinition(await c.req.json().catch(() => null));
  await runBatch(db, [
    db
      .update(workflowDefinitions)
      .set({ name: input.name, updatedAt: Date.now() })
      .where(eq(workflowDefinitions.id, def.id)),
    db.delete(workflowSteps).where(eq(workflowSteps.workflowId, def.id)),
    db.insert(workflowSteps).values(stepRows(def.id, input.steps)),
    auditEntry(db, {
      userId: c.get('user').id,
      workspaceId,
      action: 'workflow.updated',
      targetType: 'workflow',
      targetId: def.id,
    }),
  ]);
  return c.json({ id: def.id });
});

workflowRoutes.delete(
  '/:workspaceId/workflows/:id',
  requireWorkspacePermission('delete'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const { def } = await loadDefinition(db, workspaceId, c.req.param('id'));
    await runBatch(db, [
      db.delete(workflowDefinitions).where(eq(workflowDefinitions.id, def.id)),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: 'workflow.deleted',
        targetType: 'workflow',
        targetId: def.id,
      }),
    ]);
    return c.json({ deleted: true });
  },
);

// ---------- execução ----------

const runSchema = z.strictObject({
  primaryDocumentId: z.string().max(64).optional(),
  secondaryDocumentId: z.string().max(64).optional(),
});

function view(row: typeof workflowExecutions.$inferSelect, state: State | null) {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status as ExecutionStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    startedBy: state?.startedBy ?? null,
    usedMs: state?.usedMs ?? 0,
    steps: state?.steps.map((s, i) => ({ position: i + 1, kind: s.kind })) ?? [],
    log: state?.entries ?? [],
  };
}

const parseState = (row: { stepLog: string | null }): State | null => {
  try {
    return row.stepLog ? (JSON.parse(row.stepLog) as State) : null;
  } catch {
    return null;
  }
};

async function notify(
  db: Db,
  userIds: string[],
  kind: string,
  data: { executionId: string; workflowId: string; workflowName: string },
) {
  if (userIds.length === 0) return;
  await db
    .insert(notifications)
    .values([...new Set(userIds)].map((userId) => ({ userId, kind, body: JSON.stringify(data) })));
}

/** Quem pode aprovar: membros com a permissão; em time, nunca quem iniciou a execução. */
async function approverIds(db: Db, workspaceId: string, starter: string): Promise<string[]> {
  const members = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const can_ = members.filter((m) => isRole(m.role) && can(m.role, 'approve'));
  if (members.length <= 1) return [starter]; // workspace pessoal: o próprio usuário
  return can_.map((m) => m.userId).filter((id) => id !== starter);
}

/** Roda o motor a partir de `state.nextIndex` e grava o resultado. */
async function advance(opts: {
  db: Db;
  workspaceId: string;
  executionId: string;
  workflowId: string;
  workflowName: string;
  state: State;
  limits: Limits;
  userId: string;
}): Promise<{ status: ExecutionStatus; state: State }> {
  const { db, state } = opts;
  const out = await runWorkflow({
    steps: state.steps,
    startIndex: state.nextIndex,
    ctx: state.ctx ?? {},
    usedMs: state.usedMs,
    limits: opts.limits,
    execute: makeExecutor({
      db,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      inputs: state.inputs,
    }),
  });
  const finished = out.status !== 'awaiting_approval';
  const next: State = {
    ...state,
    entries: [...state.entries, ...out.log],
    nextIndex: out.nextIndex,
    usedMs: out.usedMs,
    // O contexto traz dados extraídos: só fica guardado enquanto a execução espera aprovação.
    ctx: finished ? null : out.ctx,
  };
  await db
    .update(workflowExecutions)
    .set({
      status: out.status,
      stepLog: JSON.stringify(next),
      finishedAt: finished ? Date.now() : null,
    })
    .where(eq(workflowExecutions.id, opts.executionId));

  const data = {
    executionId: opts.executionId,
    workflowId: opts.workflowId,
    workflowName: opts.workflowName,
  };
  if (out.status === 'awaiting_approval') {
    await notify(
      db,
      await approverIds(db, opts.workspaceId, state.startedBy),
      'workflow_approval_pending',
      data,
    );
  } else {
    await notify(db, [state.startedBy], `workflow_${out.status}`, data);
  }
  return { status: out.status, state: next };
}

workflowRoutes.post(
  '/:workspaceId/workflows/:id/run',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db, config } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const { def, steps } = await loadDefinition(db, workspaceId, c.req.param('id'));
    const body = await parseBody(c, runSchema);

    const needed = requiredInputs(steps);
    const inputs: Inputs = {};
    if (body.primaryDocumentId) inputs.primary = body.primaryDocumentId;
    if (body.secondaryDocumentId) inputs.secondary = body.secondaryDocumentId;
    for (const n of needed) {
      if (!inputs[n])
        throw new AppError('VALIDATION_ERROR', 400, `Informe o documento da entrada "${n}".`);
    }
    // As entradas precisam ser documentos DESTE workspace (isolamento entre workspaces).
    for (const [n, id] of Object.entries(inputs)) {
      const found = (
        await db
          .select({ id: documents.id, folderId: documents.folderId })
          .from(documents)
          .where(and(eq(documents.id, id), eq(documents.workspaceId, workspaceId)))
          .limit(1)
      )[0];
      if (found) await assertFolderAccess(c, found.folderId, 'read');
      if (!found)
        throw new AppError('NOT_FOUND', 404, `Documento da entrada "${n}" não encontrado.`);
    }

    const executionId = crypto.randomUUID();
    const state: State = {
      v: 1,
      steps,
      inputs,
      startedBy: user.id,
      ctx: {},
      entries: [],
      nextIndex: 0,
      usedMs: 0,
    };
    await runBatch(db, [
      db.insert(workflowExecutions).values({
        id: executionId,
        workflowId: def.id,
        status: 'running',
        stepLog: JSON.stringify(state),
        startedAt: Date.now(),
      }),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'workflow.started',
        targetType: 'workflow_execution',
        targetId: executionId,
      }),
    ]);

    const result = await advance({
      db,
      workspaceId,
      executionId,
      workflowId: def.id,
      workflowName: def.name,
      state,
      limits: config.workflowLimits ?? {},
      userId: user.id,
    });
    const row = (
      await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, executionId))
        .limit(1)
    )[0];
    return c.json(view(row as typeof workflowExecutions.$inferSelect, result.state), 201);
  },
);

async function loadExecution(db: Db, workspaceId: string, id: string) {
  const rows = await db
    .select({ e: workflowExecutions, name: workflowDefinitions.name })
    .from(workflowExecutions)
    .innerJoin(workflowDefinitions, eq(workflowExecutions.workflowId, workflowDefinitions.id))
    .where(and(eq(workflowExecutions.id, id), eq(workflowDefinitions.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound();
  return { row: row.e, name: row.name, state: parseState(row.e) };
}

workflowRoutes.get(
  '/:workspaceId/workflows/:id/executions',
  requireWorkspacePermission('read'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const { def } = await loadDefinition(db, workspaceId, c.req.param('id'));
    const rows = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, def.id))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(20);
    return c.json({ executions: rows.map((r) => view(r, parseState(r))) });
  },
);

workflowRoutes.get(
  '/:workspaceId/workflow-executions/:eid',
  requireWorkspacePermission('read'),
  async (c) => {
    const { workspaceId } = c.get('member');
    const { row, state, name } = await loadExecution(
      c.get('deps').db,
      workspaceId,
      c.req.param('eid'),
    );
    return c.json({ ...view(row, state), workflowName: name });
  },
);

// ---------- decisão de aprovação ----------

const decisionSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
  /** Workspace pessoal: confirmação explícita de que a aprovação não pode ser desfeita. */
  confirm: z.boolean().optional(),
});

workflowRoutes.post(
  '/:workspaceId/workflow-executions/:eid/decision',
  requireWorkspacePermission('approve'),
  async (c) => {
    const { db, config } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const body = await parseBody(c, decisionSchema);
    const { row, state, name } = await loadExecution(db, workspaceId, c.req.param('eid'));
    if (row.status !== 'awaiting_approval' || !state) {
      throw new AppError('CONFLICT', 409, 'Esta execução não está aguardando aprovação.');
    }
    const memberCount = (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId))
    )[0]?.n;
    const personal = Number(memberCount ?? 0) <= 1;
    if (!personal && state.startedBy === user.id) {
      // Separação de funções: em equipe, quem iniciou não aprova a própria execução.
      throw forbidden();
    }
    if (personal && body.decision === 'approved' && body.confirm !== true) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Em workspace pessoal, confirme que entende que a aprovação não pode ser desfeita.',
      );
    }

    // "Reivindica" a execução: só um pedido consegue sair de awaiting_approval.
    const claimed = await db
      .update(workflowExecutions)
      .set({ status: 'running' })
      .where(
        and(eq(workflowExecutions.id, row.id), eq(workflowExecutions.status, 'awaiting_approval')),
      )
      .returning({ id: workflowExecutions.id });
    if (claimed.length === 0) throw new AppError('CONFLICT', 409, 'Esta execução já foi decidida.');

    const now = Date.now();
    const idx = state.nextIndex; // passo de aprovação
    const entries = state.entries.map((e) =>
      e.position === idx + 1 && e.status === 'awaiting_approval'
        ? {
            ...e,
            status: (body.decision === 'approved'
              ? 'completed'
              : 'rejected') as StepLogEntry['status'],
            finishedAt: now,
            result: { decision: body.decision, decidedBy: user.id },
          }
        : e,
    );
    await db.insert(approvals).values({
      workspaceId,
      subjectType: 'workflow_execution',
      subjectId: row.id,
      decidedBy: user.id,
      decision: body.decision,
      note: body.note ?? null,
      decidedAt: now,
    });
    await auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: `workflow.${body.decision}`,
      targetType: 'workflow_execution',
      targetId: row.id,
    });

    const data = { executionId: row.id, workflowId: row.workflowId, workflowName: name };
    if (body.decision === 'rejected') {
      const next: State = { ...state, entries, ctx: null };
      await db
        .update(workflowExecutions)
        .set({ status: 'rejected', stepLog: JSON.stringify(next), finishedAt: now })
        .where(eq(workflowExecutions.id, row.id));
      await notify(db, [state.startedBy], 'workflow_rejected', data);
      const fresh = (
        await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, row.id)).limit(1)
      )[0];
      return c.json(view(fresh as typeof workflowExecutions.$inferSelect, next));
    }

    const result = await advance({
      db,
      workspaceId,
      executionId: row.id,
      workflowId: row.workflowId,
      workflowName: name,
      state: { ...state, entries, nextIndex: idx + 1 },
      limits: config.workflowLimits ?? {},
      userId: state.startedBy,
    });
    const fresh = (
      await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, row.id)).limit(1)
    )[0];
    return c.json(view(fresh as typeof workflowExecutions.$inferSelect, result.state));
  },
);

workflowRoutes.post(
  '/:workspaceId/workflow-executions/:eid/cancel',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const { row, state } = await loadExecution(db, workspaceId, c.req.param('eid'));
    const cancelled = await db
      .update(workflowExecutions)
      .set({
        status: 'cancelled',
        finishedAt: Date.now(),
        stepLog: state ? JSON.stringify({ ...state, ctx: null }) : row.stepLog,
      })
      .where(
        and(eq(workflowExecutions.id, row.id), eq(workflowExecutions.status, 'awaiting_approval')),
      )
      .returning({ id: workflowExecutions.id });
    if (cancelled.length === 0)
      throw new AppError(
        'CONFLICT',
        409,
        'Só execuções aguardando aprovação podem ser canceladas.',
      );
    await auditEntry(db, {
      userId: c.get('user').id,
      workspaceId,
      action: 'workflow.cancelled',
      targetType: 'workflow_execution',
      targetId: row.id,
    });
    return c.json({ cancelled: true });
  },
);
