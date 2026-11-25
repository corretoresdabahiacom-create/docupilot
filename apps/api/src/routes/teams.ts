import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  canAssignRole,
  canManageMember,
  folderGrantSchema,
  folderRestrictSchema,
  inviteAcceptSchema,
  inviteCreateSchema,
  isRole,
  memberUpdateSchema,
  organizationCreateSchema,
  workspaceCreateSchema,
  type Role,
} from '@docupilot/shared';
import { randomToken, sha256Hex } from '../auth/crypto';
import { runBatch } from '../db/batch';
import {
  auditLogs,
  documentVersions,
  folderMembers,
  folders,
  organizationInvites,
  organizationMembers,
  organizations,
  userProfiles,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { AppError, forbidden, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import { loadQuotas } from '../quotas';
import type { AppVariables } from '../types';

export const teamRoutes = new Hono<{ Variables: AppVariables }>();

const HOUR_MS = 3_600_000;

// ---------- empresas (organizations) ----------

teamRoutes.post('/organizations', requireAuth, async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  const input = await parseBody(c, organizationCreateSchema);
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const workspaceName = input.workspaceName ?? 'Geral';
  await runBatch(db, [
    db
      .insert(organizations)
      .values({ id: orgId, name: input.name, kind: 'company', ownerUserId: user.id }),
    db
      .insert(organizationMembers)
      .values({ organizationId: orgId, userId: user.id, role: 'owner' }),
    db
      .insert(workspaces)
      .values({ id: workspaceId, organizationId: orgId, name: workspaceName, isPersonal: false }),
    db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'owner' }),
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'organization.created',
      targetType: 'organization',
      targetId: orgId,
    }),
  ]);
  return c.json(
    {
      organization: { id: orgId, name: input.name, kind: 'company' },
      workspace: { id: workspaceId, name: workspaceName, isPersonal: false, role: 'owner' },
    },
    201,
  );
});

teamRoutes.get('/organizations', requireAuth, async (c) => {
  const { db } = c.get('deps');
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      kind: organizations.kind,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, c.get('user').id))
    .orderBy(asc(organizations.name));
  return c.json({ organizations: rows });
});

/** Novo workspace dentro de uma empresa: só owner/admin da empresa. */
teamRoutes.post('/organizations/:orgId/workspaces', requireAuth, async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  const orgId = c.req.param('orgId');
  const org = (
    await db
      .select({ role: organizationMembers.role, kind: organizations.kind })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)),
      )
      .limit(1)
  )[0];
  if (!org) throw notFound();
  if (org.kind !== 'company' || (org.role !== 'owner' && org.role !== 'admin')) throw forbidden();
  const input = await parseBody(c, workspaceCreateSchema);
  const workspaceId = crypto.randomUUID();
  await runBatch(db, [
    db
      .insert(workspaces)
      .values({ id: workspaceId, organizationId: orgId, name: input.name, isPersonal: false }),
    // Quem cria é owner do novo workspace.
    db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'owner' }),
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: workspaceId,
    }),
  ]);
  return c.json(
    { workspace: { id: workspaceId, name: input.name, isPersonal: false, role: 'owner' } },
    201,
  );
});

// ---------- membros ----------

async function memberUsage(db: AppVariables['deps']['db'], workspaceId: string) {
  const rows = await db
    .select({
      userId: documentVersions.createdBy,
      total: sql<number>`coalesce(sum(${documentVersions.sizeBytes}), 0)`,
    })
    .from(documentVersions)
    .where(eq(documentVersions.workspaceId, workspaceId))
    .groupBy(documentVersions.createdBy);
  return new Map(rows.map((r) => [r.userId, Number(r.total)]));
}

teamRoutes.get(
  '/workspaces/:workspaceId/members',
  requireAuth,
  requireWorkspacePermission('read'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId, role } = c.get('member');
    const me = c.get('user');
    const quotas = await loadQuotas(db);
    const manager = role === 'owner' || role === 'admin';
    const rows = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        quotaBytes: workspaceMembers.quotaBytes,
        joinedAt: workspaceMembers.createdAt,
        displayName: userProfiles.displayName,
        email: users.email,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(workspaceMembers.createdAt));
    const usage = await memberUsage(db, workspaceId);
    return c.json({
      members: rows.map((m) => ({
        userId: m.userId,
        role: m.role,
        displayName: m.displayName,
        joinedAt: m.joinedAt,
        isMe: m.userId === me.id,
        // E-mail e cota só para quem gerencia membros; cada um vê o próprio uso.
        ...(manager ? { email: m.email } : {}),
        ...(manager || m.userId === me.id
          ? {
              usedBytes: usage.get(m.userId) ?? 0,
              quotaBytes: m.quotaBytes ?? quotas.storageBytesPerMember,
              quotaIsDefault: m.quotaBytes === null,
            }
          : {}),
      })),
      maxMembers: quotas.membersPerWorkspace,
    });
  },
);

async function targetMember(c: Parameters<typeof requireAuth>[0], userId: string) {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const row = (
    await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .limit(1)
  )[0];
  if (!row || !isRole(row.role)) throw notFound();
  return row.role;
}

teamRoutes.patch(
  '/workspaces/:workspaceId/members/:userId',
  requireAuth,
  requireWorkspacePermission('manage_members'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId, role: actorRole } = c.get('member');
    const me = c.get('user');
    const userId = c.req.param('userId');
    const input = await parseBody(c, memberUpdateSchema);
    const current = await targetMember(c, userId);
    if (userId === me.id && input.role !== undefined) {
      throw new AppError('FORBIDDEN', 403, 'Você não pode alterar o próprio papel.');
    }
    if (!canManageMember(actorRole, current)) throw forbidden();
    if (input.role !== undefined && !canAssignRole(actorRole, input.role)) throw forbidden();
    const set: { role?: Role; quotaBytes?: number | null } = {};
    if (input.role !== undefined) set.role = input.role;
    if (input.quotaBytes !== undefined) set.quotaBytes = input.quotaBytes;
    await runBatch(db, [
      db
        .update(workspaceMembers)
        .set(set)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        ),
      auditEntry(db, {
        userId: me.id,
        workspaceId,
        action: 'member.updated',
        targetType: 'user',
        targetId: userId,
        meta: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.quotaBytes !== undefined ? { quotaChanged: true } : {}),
        },
      }),
    ]);
    return c.json({ ok: true });
  },
);

/** Remover membro (gestor acima dele) ou sair do workspace (o próprio membro, exceto o owner). */
teamRoutes.delete(
  '/workspaces/:workspaceId/members/:userId',
  requireAuth,
  async (c, next) => {
    // Sair não exige `manage_members`: só ser membro.
    if (c.req.param('userId') === c.get('user').id) {
      return requireWorkspacePermission('read')(c, next);
    }
    return requireWorkspacePermission('manage_members')(c, next);
  },
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId, role: actorRole } = c.get('member');
    const me = c.get('user');
    const userId = c.req.param('userId');
    const current = await targetMember(c, userId);
    if (userId === me.id) {
      if (current === 'owner') {
        throw new AppError('CONFLICT', 409, 'O proprietário não pode sair do workspace.');
      }
    } else if (!canManageMember(actorRole, current)) {
      throw forbidden();
    }
    await runBatch(db, [
      db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        ),
      // Concessões em pastas deste workspace deixam de valer.
      db
        .delete(folderMembers)
        .where(
          and(
            eq(folderMembers.userId, userId),
            sql`${folderMembers.folderId} IN (SELECT id FROM folders WHERE workspace_id = ${workspaceId})`,
          ),
        ),
      auditEntry(db, {
        userId: me.id,
        workspaceId,
        action: userId === me.id ? 'member.left' : 'member.removed',
        targetType: 'user',
        targetId: userId,
      }),
    ]);
    return c.json({ ok: true });
  },
);

// ---------- convites por link ----------

async function assertCompanyWorkspace(c: Parameters<typeof requireAuth>[0]) {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const ws = (
    await db
      .select({ isPersonal: workspaces.isPersonal, organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
  )[0];
  if (!ws) throw notFound();
  if (ws.isPersonal) {
    throw new AppError('CONFLICT', 409, 'Workspace pessoal não aceita convites.');
  }
  return ws;
}

teamRoutes.post(
  '/workspaces/:workspaceId/invites',
  requireAuth,
  requireWorkspacePermission('manage_members'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId, role: actorRole } = c.get('member');
    const me = c.get('user');
    const input = await parseBody(c, inviteCreateSchema);
    if (!canAssignRole(actorRole, input.role)) throw forbidden();
    const ws = await assertCompanyWorkspace(c);
    const quotas = await loadQuotas(db);
    const now = Date.now();
    const pending = await db
      .select({ id: organizationInvites.id })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.workspaceId, workspaceId),
          isNull(organizationInvites.usedAt),
          gt(organizationInvites.expiresAt, now),
        ),
      );
    if (pending.length >= quotas.invitesPendingPerWorkspace) {
      throw new AppError('QUOTA_EXCEEDED', 429, 'Há convites pendentes demais neste workspace.');
    }
    const token = randomToken(32);
    const inviteId = crypto.randomUUID();
    const expiresAt = now + input.expiresInHours * HOUR_MS;
    await runBatch(db, [
      db.insert(organizationInvites).values({
        id: inviteId,
        organizationId: ws.organizationId,
        workspaceId,
        tokenHash: await sha256Hex(token),
        role: input.role,
        createdBy: me.id,
        expiresAt,
      }),
      auditEntry(db, {
        userId: me.id,
        workspaceId,
        action: 'invite.created',
        targetType: 'invite',
        targetId: inviteId,
        meta: { role: input.role },
      }),
    ]);
    // O token só aparece AQUI; no banco fica apenas o hash. Sem e-mail transacional: o link é
    // entregue pelo próprio usuário (copiar e enviar).
    return c.json(
      { invite: { id: inviteId, role: input.role, expiresAt, token, path: `/convite/${token}` } },
      201,
    );
  },
);

teamRoutes.get(
  '/workspaces/:workspaceId/invites',
  requireAuth,
  requireWorkspacePermission('manage_members'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const rows = await db
      .select({
        id: organizationInvites.id,
        role: organizationInvites.role,
        expiresAt: organizationInvites.expiresAt,
        usedAt: organizationInvites.usedAt,
        createdAt: organizationInvites.createdAt,
      })
      .from(organizationInvites)
      .where(eq(organizationInvites.workspaceId, workspaceId))
      .orderBy(desc(organizationInvites.createdAt))
      .limit(50);
    const now = Date.now();
    return c.json({
      invites: rows.map((r) => ({
        ...r,
        status: r.usedAt ? 'used' : r.expiresAt <= now ? 'expired' : 'pending',
      })),
    });
  },
);

teamRoutes.delete(
  '/workspaces/:workspaceId/invites/:inviteId',
  requireAuth,
  requireWorkspacePermission('manage_members'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const inviteId = c.req.param('inviteId');
    const found = (
      await db
        .select({ id: organizationInvites.id, usedAt: organizationInvites.usedAt })
        .from(organizationInvites)
        .where(
          and(
            eq(organizationInvites.id, inviteId),
            eq(organizationInvites.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    )[0];
    if (!found) throw notFound();
    await runBatch(db, [
      db.delete(organizationInvites).where(eq(organizationInvites.id, inviteId)),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: 'invite.revoked',
        targetType: 'invite',
        targetId: inviteId,
      }),
    ]);
    return c.json({ ok: true });
  },
);

async function findValidInvite(db: AppVariables['deps']['db'], token: string) {
  const row = (
    await db
      .select({
        id: organizationInvites.id,
        organizationId: organizationInvites.organizationId,
        workspaceId: organizationInvites.workspaceId,
        role: organizationInvites.role,
        expiresAt: organizationInvites.expiresAt,
        usedAt: organizationInvites.usedAt,
        workspaceName: workspaces.name,
        isPersonal: workspaces.isPersonal,
        organizationName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(workspaces, eq(workspaces.id, organizationInvites.workspaceId))
      .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
      .where(eq(organizationInvites.tokenHash, await sha256Hex(token)))
      .limit(1)
  )[0];
  // Token desconhecido, usado, expirado ou de workspace pessoal: a mesma resposta (404).
  if (!row || row.usedAt !== null || row.expiresAt <= Date.now() || row.isPersonal) return null;
  if (!isRole(row.role)) return null;
  return { ...row, role: row.role };
}

/** Prévia do convite para quem recebeu o link (antes de entrar). Só dados mínimos. */
teamRoutes.get('/invites/:token', async (c) => {
  const invite = await findValidInvite(c.get('deps').db, c.req.param('token'));
  if (!invite) throw notFound();
  return c.json({
    invite: {
      organizationName: invite.organizationName,
      workspaceName: invite.workspaceName,
      role: invite.role,
      expiresAt: invite.expiresAt,
    },
  });
});

teamRoutes.post('/invites/accept', requireAuth, async (c) => {
  const { db } = c.get('deps');
  const me = c.get('user');
  const input = await parseBody(c, inviteAcceptSchema);
  const invite = await findValidInvite(db, input.token);
  if (!invite || !invite.workspaceId) throw notFound();
  const workspaceId = invite.workspaceId;

  const already = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, me.id)))
    .limit(1);
  if (already.length > 0) {
    throw new AppError('CONFLICT', 409, 'Você já é membro deste workspace.');
  }
  const quotas = await loadQuotas(db);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  if (Number(count[0]?.n ?? 0) >= quotas.membersPerWorkspace) {
    throw new AppError('QUOTA_EXCEEDED', 429, 'O workspace atingiu o limite de membros.');
  }

  // Consumo atômico: só um aceite vence a corrida pelo mesmo link (uso único).
  await db.transaction(async (tx) => {
    const used = await tx
      .update(organizationInvites)
      .set({ usedAt: Date.now() })
      .where(
        and(
          eq(organizationInvites.id, invite.id),
          isNull(organizationInvites.usedAt),
          gt(organizationInvites.expiresAt, Date.now()),
        ),
      )
      .returning({ id: organizationInvites.id });
    if (used.length === 0) throw notFound();
    await tx.insert(workspaceMembers).values({ workspaceId, userId: me.id, role: invite.role });
    await tx
      .insert(organizationMembers)
      .values({ organizationId: invite.organizationId, userId: me.id, role: invite.role })
      .onConflictDoNothing();
    await tx.insert(auditLogs).values({
      userId: me.id,
      workspaceId,
      action: 'invite.accepted',
      targetType: 'invite',
      targetId: invite.id,
      meta: JSON.stringify({ role: invite.role }),
    });
  });
  return c.json({ workspace: { id: workspaceId, name: invite.workspaceName, role: invite.role } });
});

// ---------- histórico por workspace ----------

teamRoutes.get(
  '/workspaces/:workspaceId/activity',
  requireAuth,
  requireWorkspacePermission('share'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const before = Number(c.req.query('before'));
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        meta: auditLogs.meta,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        displayName: userProfiles.displayName,
      })
      .from(auditLogs)
      .leftJoin(userProfiles, eq(userProfiles.userId, auditLogs.userId))
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          Number.isFinite(before) && before > 0 ? lt(auditLogs.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return c.json({
      events: page.map((r) => ({
        ...r,
        // Só metadados: nunca conteúdo de documento (decisão do briefing).
        meta: r.meta ? safeJson(r.meta) : null,
      })),
      next: rows.length > limit ? (page[page.length - 1]?.createdAt ?? null) : null,
    });
  },
);

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------- pastas compartilhadas (restritas + concessões por membro) ----------

async function loadFolder(c: Parameters<typeof requireAuth>[0], folderId: string) {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const f = (
    await db
      .select({ id: folders.id, restricted: folders.restricted })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!f) throw notFound();
  return f;
}

teamRoutes.get(
  '/workspaces/:workspaceId/folders/:folderId/access',
  requireAuth,
  requireWorkspacePermission('share'),
  async (c) => {
    const { db } = c.get('deps');
    const folder = await loadFolder(c, c.req.param('folderId'));
    const grants = await db
      .select({
        userId: folderMembers.userId,
        access: folderMembers.access,
        displayName: userProfiles.displayName,
      })
      .from(folderMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, folderMembers.userId))
      .where(eq(folderMembers.folderId, folder.id));
    return c.json({ restricted: folder.restricted, grants });
  },
);

teamRoutes.put(
  '/workspaces/:workspaceId/folders/:folderId/access',
  requireAuth,
  requireWorkspacePermission('share'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const input = await parseBody(c, folderRestrictSchema);
    const folder = await loadFolder(c, c.req.param('folderId'));
    await runBatch(db, [
      db
        .update(folders)
        .set({ restricted: input.restricted, updatedAt: Date.now() })
        .where(eq(folders.id, folder.id)),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: input.restricted ? 'folder.restricted' : 'folder.unrestricted',
        targetType: 'folder',
        targetId: folder.id,
      }),
    ]);
    return c.json({ restricted: input.restricted });
  },
);

teamRoutes.put(
  '/workspaces/:workspaceId/folders/:folderId/access/:userId',
  requireAuth,
  requireWorkspacePermission('share'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const userId = c.req.param('userId');
    const input = await parseBody(c, folderGrantSchema);
    const folder = await loadFolder(c, c.req.param('folderId'));
    // A concessão só vale para quem é membro DESTE workspace.
    await targetMember(c, userId);
    await runBatch(db, [
      db
        .insert(folderMembers)
        .values({ folderId: folder.id, userId, access: input.access, grantedBy: c.get('user').id })
        .onConflictDoUpdate({
          target: [folderMembers.folderId, folderMembers.userId],
          set: { access: input.access, grantedBy: c.get('user').id },
        }),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: 'folder.access_granted',
        targetType: 'folder',
        targetId: folder.id,
        meta: { access: input.access },
      }),
    ]);
    return c.json({ ok: true });
  },
);

teamRoutes.delete(
  '/workspaces/:workspaceId/folders/:folderId/access/:userId',
  requireAuth,
  requireWorkspacePermission('share'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const folder = await loadFolder(c, c.req.param('folderId'));
    await runBatch(db, [
      db
        .delete(folderMembers)
        .where(
          and(
            eq(folderMembers.folderId, folder.id),
            eq(folderMembers.userId, c.req.param('userId')),
          ),
        ),
      auditEntry(db, {
        userId: c.get('user').id,
        workspaceId,
        action: 'folder.access_revoked',
        targetType: 'folder',
        targetId: folder.id,
      }),
    ]);
    return c.json({ ok: true });
  },
);
