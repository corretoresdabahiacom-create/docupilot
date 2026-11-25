import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  adminFlagSchema,
  adminQuotaSchema,
  adminUserStatusSchema,
  DEFAULT_QUOTAS,
  REPORT_GRACE_HOURS,
  reportRemoveSchema,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import { queryRows } from '../db/raw';
import {
  auditLogs,
  documentMetadata,
  documents,
  documentVersions,
  featureFlags,
  notifications,
  organizations,
  reports,
  sharedLinks,
  systemSettings,
  uploads,
  users,
  workflowDefinitions,
  workflowExecutions,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { deleteDocumentCascade } from '../documentOps';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAdmin } from '../middleware/admin';
import { loadQuotas } from '../quotas';
import { runRetention } from '../retention';
import type { AppVariables } from '../types';

/**
 * Painel de administração (Fase 8). REGRA: só metadados. Nenhuma rota devolve conteúdo de
 * documento, texto extraído, campos extraídos, nome de arquivo ou perfis pessoais. Nomes de
 * arquivo ficam de fora de propósito: podem conter dados pessoais.
 */
export const adminRoutes = new Hono<{ Variables: AppVariables }>();
adminRoutes.use('*', requireAdmin);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const num = (v: unknown) => Number(v ?? 0);
const page = (c: { req: { query: (k: string) => string | undefined } }) => ({
  limit: Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100),
  offset: Math.max(Number(c.req.query('offset')) || 0, 0),
});

/** Limites de referência do plano gratuito do Supabase: NÃO verificados (ver docs). */
const DB_NOMINAL_BYTES = 500 * 1024 ** 2;

// ---------- visão geral ----------

adminRoutes.get('/overview', async (c) => {
  const { db } = c.get('deps');
  const now = Date.now();
  const quotas = await loadQuotas(db);
  const one = async (q: Promise<{ n: unknown }[]>) => num((await q)[0]?.n);

  const [
    activeUsers,
    suspendedUsers,
    orgs,
    wss,
    docs,
    docStatus,
    storage,
    openReports,
    notifiedReports,
    stuckExecutions,
    pendingApprovals,
    stuckExtractions,
    stalePendingUploads,
    failedExecutions,
    failedExtractions,
    rejectedUploads,
    activeLinks,
    expiredLinks,
  ] = await Promise.all([
    one(db.select({ n: count() }).from(users).where(eq(users.status, 'active'))),
    one(db.select({ n: count() }).from(users).where(eq(users.status, 'suspended'))),
    one(db.select({ n: count() }).from(organizations)),
    one(db.select({ n: count() }).from(workspaces)),
    one(db.select({ n: count() }).from(documents)),
    db.select({ status: documents.status, n: count() }).from(documents).groupBy(documents.status),
    db
      .select({
        bytes: sql<number>`coalesce(sum(${workspaces.storageBytesUsed}), 0)`,
        chars: sql<number>`coalesce(sum(${workspaces.textCharsUsed}), 0)`,
      })
      .from(workspaces),
    one(db.select({ n: count() }).from(reports).where(eq(reports.status, 'open'))),
    one(db.select({ n: count() }).from(reports).where(eq(reports.status, 'owner_notified'))),
    one(
      db
        .select({ n: count() })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, 'running'),
            lt(workflowExecutions.startedAt, now - 15 * 60_000),
          ),
        ),
    ),
    one(
      db
        .select({ n: count() })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, 'awaiting_approval'),
            lt(workflowExecutions.startedAt, now - 7 * DAY),
          ),
        ),
    ),
    one(
      db
        .select({ n: count() })
        .from(documents)
        .where(and(eq(documents.status, 'needs_text'), lt(documents.createdAt, now - DAY))),
    ),
    one(
      db
        .select({ n: count() })
        .from(uploads)
        .where(and(eq(uploads.status, 'pending'), lt(uploads.createdAt, now - HOUR))),
    ),
    one(
      db
        .select({ n: count() })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, 'failed'),
            gt(workflowExecutions.startedAt, now - 7 * DAY),
          ),
        ),
    ),
    one(db.select({ n: count() }).from(documents).where(eq(documents.status, 'extraction_failed'))),
    one(
      db
        .select({ n: count() })
        .from(uploads)
        .where(and(eq(uploads.status, 'rejected'), gt(uploads.createdAt, now - 7 * DAY))),
    ),
    one(
      db
        .select({ n: count() })
        .from(sharedLinks)
        .where(and(isNull(sharedLinks.revokedAt), gt(sharedLinks.expiresAt, now))),
    ),
    one(db.select({ n: count() }).from(sharedLinks).where(lt(sharedLinks.expiresAt, now))),
  ]);

  let dbBytes: number | null;
  try {
    const r = await queryRows<{ size: string | number }>(
      db,
      sql`select pg_database_size(current_database()) as size`,
    );
    dbBytes = r[0] ? Number(r[0].size) : null;
  } catch {
    dbBytes = null;
  }

  return c.json({
    generatedAt: now,
    totals: {
      activeUsers,
      suspendedUsers,
      organizations: orgs,
      workspaces: wss,
      documents: docs,
      documentsByStatus: Object.fromEntries(docStatus.map((r) => [r.status, num(r.n)])),
    },
    consumption: {
      storageBytes: num(storage[0]?.bytes),
      storageGlobalQuotaBytes: quotas.storageBytesGlobal,
      textChars: num(storage[0]?.chars),
      database: {
        bytes: dbBytes,
        // Referência NÃO verificada; confira o limite atual no painel do Supabase.
        nominalLimitBytes: DB_NOMINAL_BYTES,
        nominalVerified: false,
      },
      // O app não mede o consumo de Workers (requisições/CPU) nem de R2/Supabase Storage na
      // fonte: confira nos painéis da Cloudflare e do Supabase. Nada é inventado aqui.
      workers: { measured: false },
      objectStorage: { measured: false, appTrackedBytes: num(storage[0]?.bytes) },
    },
    jobs: {
      stuckExecutions,
      pendingApprovalsOver7d: pendingApprovals,
      stuckExtractions,
      stalePendingUploads,
    },
    failures: {
      failedExecutions7d: failedExecutions,
      extractionFailedDocuments: failedExtractions,
      rejectedUploads7d: rejectedUploads,
    },
    reports: { open: openReports, ownerNotified: notifiedReports },
    shares: {
      // O compartilhamento por link ainda não tem rotas; as contagens vêm da tabela e valem 0.
      featureImplemented: false,
      activeLinks,
      expiredLinks,
    },
  });
});

// ---------- usuários, organizações, workspaces, documentos ----------

adminRoutes.get('/users', async (c) => {
  const { db } = c.get('deps');
  const { limit, offset } = page(c);
  const q = c.req.query('q')?.trim().toLowerCase();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
      isPlatformAdmin: users.isPlatformAdmin,
      createdAt: users.createdAt,
      workspaces: sql<number>`(select count(*) from workspace_members m where m.user_id = ${users.id})`,
    })
    .from(users)
    .where(
      q
        ? sql`lower(${users.email}) like ${`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`
        : undefined,
    )
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ users: rows.map((r) => ({ ...r, workspaces: num(r.workspaces) })) });
});

adminRoutes.patch('/users/:userId', async (c) => {
  const { db } = c.get('deps');
  const me = c.get('user');
  const userId = c.req.param('userId');
  const input = await parseBody(c, adminUserStatusSchema);
  const target = (
    await db
      .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!target) throw notFound();
  if (target.id === me.id || target.isPlatformAdmin) {
    throw new AppError('FORBIDDEN', 403, 'Não é possível suspender administradores da plataforma.');
  }
  await runBatch(db, [
    db
      .update(users)
      .set({ status: input.status, updatedAt: Date.now() })
      .where(eq(users.id, userId)),
    auditEntry(db, {
      userId: me.id,
      action: input.status === 'suspended' ? 'admin.user_suspended' : 'admin.user_reactivated',
      targetType: 'user',
      targetId: userId,
    }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.get('/organizations', async (c) => {
  const { db } = c.get('deps');
  const { limit, offset } = page(c);
  const rows = await db
    .select({
      id: organizations.id,
      kind: organizations.kind,
      createdAt: organizations.createdAt,
      workspaces: sql<number>`(select count(*) from workspaces w where w.organization_id = ${organizations.id})`,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ organizations: rows.map((r) => ({ ...r, workspaces: num(r.workspaces) })) });
});

adminRoutes.get('/workspaces', async (c) => {
  const { db } = c.get('deps');
  const { limit, offset } = page(c);
  const rows = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      isPersonal: workspaces.isPersonal,
      documentCount: workspaces.documentCount,
      storageBytesUsed: workspaces.storageBytesUsed,
      createdAt: workspaces.createdAt,
      members: sql<number>`(select count(*) from workspace_members m where m.workspace_id = ${workspaces.id})`,
    })
    .from(workspaces)
    .orderBy(desc(workspaces.storageBytesUsed))
    .limit(limit)
    .offset(offset);
  return c.json({ workspaces: rows.map((r) => ({ ...r, members: num(r.members) })) });
});

/** Documentos: SOMENTE metadados técnicos (sem nome, sem texto, sem campos). */
adminRoutes.get('/documents', async (c) => {
  const { db } = c.get('deps');
  const { limit, offset } = page(c);
  const status = c.req.query('status');
  const rows = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      mime: documents.mime,
      status: documents.status,
      createdAt: documents.createdAt,
      sizeBytes: documentVersions.sizeBytes,
      pageCount: documentMetadata.pageCount,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .leftJoin(documentMetadata, eq(documentMetadata.documentId, documents.id))
    .where(status ? eq(documents.status, status) : undefined)
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ documents: rows });
});

// ---------- jobs, falhas e compartilhamentos ----------

adminRoutes.get('/jobs', async (c) => {
  const { db } = c.get('deps');
  const now = Date.now();
  const executions = await db
    .select({
      id: workflowExecutions.id,
      status: workflowExecutions.status,
      startedAt: workflowExecutions.startedAt,
      workspaceId: workflowDefinitions.workspaceId,
    })
    .from(workflowExecutions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowExecutions.workflowId))
    .where(
      sql`(${workflowExecutions.status} = 'running' and ${workflowExecutions.startedAt} < ${now - 15 * 60_000})
        or (${workflowExecutions.status} = 'awaiting_approval' and ${workflowExecutions.startedAt} < ${now - 7 * DAY})`,
    )
    .orderBy(asc(workflowExecutions.startedAt))
    .limit(50);
  const extractions = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.status, 'needs_text'), lt(documents.createdAt, now - DAY)))
    .orderBy(asc(documents.createdAt))
    .limit(50);
  return c.json({ executions, extractions });
});

adminRoutes.get('/failures', async (c) => {
  const { db } = c.get('deps');
  const since = Date.now() - 7 * DAY;
  const executions = await db
    .select({
      id: workflowExecutions.id,
      startedAt: workflowExecutions.startedAt,
      workspaceId: workflowDefinitions.workspaceId,
    })
    .from(workflowExecutions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowExecutions.workflowId))
    .where(and(eq(workflowExecutions.status, 'failed'), gt(workflowExecutions.startedAt, since)))
    .orderBy(desc(workflowExecutions.startedAt))
    .limit(50);
  const extractions = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.status, 'extraction_failed'))
    .orderBy(desc(documents.createdAt))
    .limit(50);
  return c.json({ executions, extractions });
});

adminRoutes.get('/shares', async (c) => {
  const { db } = c.get('deps');
  const rows = await db
    .select({
      id: sharedLinks.id,
      workspaceId: sharedLinks.workspaceId,
      expiresAt: sharedLinks.expiresAt,
      revokedAt: sharedLinks.revokedAt,
      createdAt: sharedLinks.createdAt,
    })
    .from(sharedLinks)
    .orderBy(desc(sharedLinks.createdAt))
    .limit(50);
  return c.json({ featureImplemented: false, links: rows });
});

// ---------- denúncias e moderação ----------

adminRoutes.get('/reports', async (c) => {
  const { db } = c.get('deps');
  const { limit, offset } = page(c);
  const status = c.req.query('status');
  const rows = await db
    .select()
    .from(reports)
    .where(status ? eq(reports.status, status) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ reports: rows, graceHours: REPORT_GRACE_HOURS });
});

async function loadReport(c: {
  get: (k: 'deps') => AppVariables['deps'];
  req: { param: (k: string) => string };
}) {
  const r = (
    await c
      .get('deps')
      .db.select()
      .from(reports)
      .where(eq(reports.id, c.req.param('reportId')))
      .limit(1)
  )[0];
  if (!r) throw notFound();
  if (r.status === 'dismissed' || r.status === 'removed') {
    throw new AppError('CONFLICT', 409, 'Denúncia já resolvida.');
  }
  return r;
}

async function reportedDocument(db: AppVariables['deps']['db'], ref: string) {
  return (
    await db
      .select({ id: documents.id, workspaceId: documents.workspaceId })
      .from(documents)
      .where(eq(documents.id, ref))
      .limit(1)
  )[0];
}

/** Avisa proprietário e administradores do workspace (notificação dentro do app). */
async function notifyOwners(
  db: AppVariables['deps']['db'],
  workspaceId: string,
  kind: string,
  data: Record<string, string | number>,
) {
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.role, ['owner', 'admin']),
      ),
    );
  if (members.length === 0) return 0;
  await db
    .insert(notifications)
    .values(members.map((m) => ({ userId: m.userId, kind, body: JSON.stringify(data) })));
  return members.length;
}

adminRoutes.post('/reports/:reportId/notify-owner', async (c) => {
  const { db } = c.get('deps');
  const me = c.get('user');
  const report = await loadReport(c);
  if (report.targetType !== 'document') {
    throw new AppError('CONFLICT', 409, 'Só denúncias de documento têm proprietário a avisar.');
  }
  const doc = await reportedDocument(db, report.targetRef);
  if (!doc) throw new AppError('NOT_FOUND', 404, 'O documento denunciado não existe mais.');
  const now = Date.now();
  const notified = await notifyOwners(db, doc.workspaceId, 'report_notice', {
    reportId: report.id,
    documentId: doc.id,
    reason: report.reason.slice(0, 300),
    graceHours: REPORT_GRACE_HOURS,
  });
  await runBatch(db, [
    db
      .update(reports)
      .set({
        status: 'owner_notified',
        ownerNotifiedAt: now,
        removalAfter: now + REPORT_GRACE_HOURS * HOUR,
      })
      .where(eq(reports.id, report.id)),
    auditEntry(db, {
      userId: me.id,
      workspaceId: doc.workspaceId,
      action: 'admin.report_owner_notified',
      targetType: 'report',
      targetId: report.id,
      meta: { notified },
    }),
  ]);
  return c.json({ ok: true, notified, removalAfter: now + REPORT_GRACE_HOURS * HOUR });
});

adminRoutes.post('/reports/:reportId/dismiss', async (c) => {
  const { db } = c.get('deps');
  const me = c.get('user');
  const report = await loadReport(c);
  await runBatch(db, [
    db
      .update(reports)
      .set({
        status: 'dismissed',
        resolution: 'dismissed',
        resolvedBy: me.id,
        resolvedAt: Date.now(),
      })
      .where(eq(reports.id, report.id)),
    auditEntry(db, {
      userId: me.id,
      action: 'admin.report_dismissed',
      targetType: 'report',
      targetId: report.id,
    }),
  ]);
  return c.json({ ok: true });
});

/**
 * Remoção do conteúdo denunciado. Regra do briefing: o proprietário é avisado ANTES, salvo
 * urgência. Sem urgência: só depois do aviso e do prazo. Com urgência: motivo obrigatório,
 * auditoria e aviso posterior ao proprietário.
 */
adminRoutes.post('/reports/:reportId/remove', async (c) => {
  const { db, storage } = c.get('deps');
  const me = c.get('user');
  const input = await parseBody(c, reportRemoveSchema);
  const report = await loadReport(c);
  if (report.targetType !== 'document') {
    throw new AppError('CONFLICT', 409, 'Só é possível remover documentos por aqui.');
  }
  const now = Date.now();
  if (!input.urgent) {
    if (report.status !== 'owner_notified' || !report.removalAfter) {
      throw new AppError(
        'CONFLICT',
        409,
        'Avise o proprietário antes de remover (ou marque urgência).',
      );
    }
    if (now < report.removalAfter) {
      throw new AppError(
        'CONFLICT',
        409,
        'O prazo de resposta do proprietário ainda não terminou.',
      );
    }
  }
  const doc = await reportedDocument(db, report.targetRef);
  if (!doc) throw new AppError('NOT_FOUND', 404, 'O documento denunciado não existe mais.');

  await deleteDocumentCascade(db, storage, doc, {
    userId: me.id,
    action: 'admin.document_removed',
    meta: { reportId: report.id, urgent: input.urgent },
  });
  await runBatch(db, [
    db
      .update(reports)
      .set({
        status: 'removed',
        resolution: input.urgent ? 'removed_urgent' : 'removed',
        resolvedBy: me.id,
        resolvedAt: now,
      })
      .where(eq(reports.id, report.id)),
    auditEntry(db, {
      userId: me.id,
      workspaceId: doc.workspaceId,
      action: input.urgent ? 'admin.report_removed_urgent' : 'admin.report_removed',
      targetType: 'report',
      targetId: report.id,
      meta: input.urgent ? { urgentReason: input.urgentReason ?? '' } : {},
    }),
  ]);
  await notifyOwners(db, doc.workspaceId, 'report_removed', {
    reportId: report.id,
    urgent: input.urgent ? 1 : 0,
  });
  return c.json({ ok: true });
});

// ---------- feature flags e quotas ----------

adminRoutes.get('/flags', async (c) => {
  const rows = await c.get('deps').db.select().from(featureFlags).orderBy(asc(featureFlags.key));
  return c.json({ flags: rows.map((f) => ({ key: f.key, enabled: f.enabled })) });
});

/**
 * Nenhuma flag pode ser LIGADA: monetização e IA externa não têm implementação (R4/R7/R8); ligar
 * a flag faria o painel prometer algo que não existe. Desligar é sempre permitido.
 */
adminRoutes.put('/flags/:key', async (c) => {
  const { db } = c.get('deps');
  const key = c.req.param('key');
  const input = await parseBody(c, adminFlagSchema);
  const flag = (await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1))[0];
  if (!flag) throw notFound();
  if (input.enabled) {
    throw new AppError(
      'CONFLICT',
      409,
      'Recurso não implementado nesta versão: não pode ser ligado.',
    );
  }
  await runBatch(db, [
    db
      .update(featureFlags)
      .set({ enabled: false, updatedAt: Date.now() })
      .where(eq(featureFlags.key, key)),
    auditEntry(db, {
      userId: c.get('user').id,
      action: 'admin.flag_disabled',
      targetType: 'flag',
      targetId: key,
    }),
  ]);
  return c.json({ key, enabled: false });
});

const QUOTA_NAMES = Object.keys(DEFAULT_QUOTAS);

adminRoutes.get('/quotas', async (c) => {
  const { db } = c.get('deps');
  const overrides = (await db.select().from(systemSettings))
    .filter((r) => r.key.startsWith('quota.'))
    .map((r) => [r.key.slice('quota.'.length), Number(r.value)] as const);
  return c.json({
    defaults: DEFAULT_QUOTAS,
    overrides: Object.fromEntries(overrides),
    effective: await loadQuotas(db),
  });
});

adminRoutes.put('/quotas/:name', async (c) => {
  const { db } = c.get('deps');
  const name = c.req.param('name');
  if (!QUOTA_NAMES.includes(name)) throw notFound();
  const input = await parseBody(c, adminQuotaSchema);
  const key = `quota.${name}`;
  await runBatch(db, [
    db
      .insert(systemSettings)
      .values({ key, value: String(input.value) })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: String(input.value), updatedAt: Date.now() },
      }),
    auditEntry(db, {
      userId: c.get('user').id,
      action: 'admin.quota_set',
      targetType: 'quota',
      targetId: name,
      meta: { value: input.value },
    }),
  ]);
  return c.json({ name, value: input.value });
});

adminRoutes.delete('/quotas/:name', async (c) => {
  const { db } = c.get('deps');
  const name = c.req.param('name');
  if (!QUOTA_NAMES.includes(name)) throw notFound();
  await runBatch(db, [
    db.delete(systemSettings).where(eq(systemSettings.key, `quota.${name}`)),
    auditEntry(db, {
      userId: c.get('user').id,
      action: 'admin.quota_reset',
      targetType: 'quota',
      targetId: name,
    }),
  ]);
  return c.json({ name, reset: true });
});

// ---------- retenção ----------

adminRoutes.post('/maintenance/retention', async (c) => {
  const { db } = c.get('deps');
  const result = await runRetention(db);
  await db.insert(auditLogs).values({
    userId: c.get('user').id,
    action: 'admin.retention_run',
    meta: JSON.stringify(result),
  });
  return c.json({ result });
});
