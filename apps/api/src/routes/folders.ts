import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  folderCreateSchema,
  folderUpdateSchema,
  MAX_FOLDER_DEPTH,
  MAX_FOLDERS_PER_WORKSPACE,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import { documents, folders } from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import type { AppVariables, Db } from '../types';

export const folderRoutes = new Hono<{ Variables: AppVariables }>();
folderRoutes.use('*', requireAuth);

type FolderRow = { id: string; parentId: string | null; name: string; depth: number };

async function listFolders(db: Db, workspaceId: string): Promise<FolderRow[]> {
  return db
    .select({
      id: folders.id,
      parentId: folders.parentId,
      name: folders.name,
      depth: folders.depth,
    })
    .from(folders)
    .where(eq(folders.workspaceId, workspaceId))
    .orderBy(asc(folders.name))
    .limit(MAX_FOLDERS_PER_WORKSPACE + 1);
}

function nameTaken(all: FolderRow[], parentId: string | null, name: string, exceptId?: string) {
  const lower = name.toLocaleLowerCase();
  return all.some(
    (f) => f.id !== exceptId && f.parentId === parentId && f.name.toLocaleLowerCase() === lower,
  );
}

/** Ids da subárvore (inclui a própria pasta) e a altura relativa (1 = só a pasta). */
function subtree(all: FolderRow[], rootId: string): { ids: string[]; height: number } {
  const children = new Map<string, FolderRow[]>();
  for (const f of all) {
    if (f.parentId) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f]);
  }
  const ids: string[] = [];
  let height = 1;
  const walk = (id: string, level: number) => {
    ids.push(id);
    height = Math.max(height, level);
    for (const child of children.get(id) ?? []) walk(child.id, level + 1);
  };
  walk(rootId, 1);
  return { ids, height };
}

folderRoutes.get('/:workspaceId/folders', requireWorkspacePermission('read'), async (c) => {
  const rows = await listFolders(c.get('deps').db, c.get('member').workspaceId);
  return c.json({ folders: rows });
});

folderRoutes.post('/:workspaceId/folders', requireWorkspacePermission('edit'), async (c) => {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const input = await parseBody(c, folderCreateSchema);
  const parentId = input.parentId ?? null;
  const all = await listFolders(db, workspaceId);
  if (all.length >= MAX_FOLDERS_PER_WORKSPACE) {
    throw new AppError('QUOTA_EXCEEDED', 429, 'Limite de pastas do workspace atingido.');
  }
  let depth = 1;
  if (parentId) {
    const parent = all.find((f) => f.id === parentId);
    if (!parent) throw notFound();
    depth = parent.depth + 1;
  }
  if (depth > MAX_FOLDER_DEPTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `Profundidade máxima de ${MAX_FOLDER_DEPTH} níveis.`,
    );
  }
  if (nameTaken(all, parentId, input.name)) {
    throw new AppError('CONFLICT', 409, 'Já existe uma pasta com esse nome neste local.');
  }
  const user = c.get('user');
  const folderId = crypto.randomUUID();
  await runBatch(db, [
    db.insert(folders).values({
      id: folderId,
      workspaceId,
      parentId,
      name: input.name,
      depth,
      createdBy: user.id,
    }),
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'folder.created',
      targetType: 'folder',
      targetId: folderId,
    }),
  ]);
  return c.json({ folder: { id: folderId, parentId, name: input.name, depth } }, 201);
});

folderRoutes.patch(
  '/:workspaceId/folders/:folderId',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, folderUpdateSchema);
    const all = await listFolders(db, workspaceId);
    const folder = all.find((f) => f.id === c.req.param('folderId'));
    if (!folder) throw notFound();

    const newName = input.name ?? folder.name;
    const newParent = input.parentId === undefined ? folder.parentId : input.parentId;
    const { ids, height } = subtree(all, folder.id);

    let newDepth = 1;
    if (newParent) {
      const parent = all.find((f) => f.id === newParent);
      if (!parent) throw notFound();
      if (ids.includes(parent.id)) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'Uma pasta não pode ser movida para dentro de si.',
        );
      }
      newDepth = parent.depth + 1;
    }
    if (newDepth + height - 1 > MAX_FOLDER_DEPTH) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        `Profundidade máxima de ${MAX_FOLDER_DEPTH} níveis.`,
      );
    }
    if (nameTaken(all, newParent, newName, folder.id)) {
      throw new AppError('CONFLICT', 409, 'Já existe uma pasta com esse nome neste local.');
    }

    const delta = newDepth - folder.depth;
    const queries: unknown[] = [
      db
        .update(folders)
        .set({ name: newName, parentId: newParent, depth: newDepth, updatedAt: Date.now() })
        .where(eq(folders.id, folder.id)),
    ];
    const descendants = ids.filter((id) => id !== folder.id);
    if (delta !== 0) {
      // D1 aceita no máximo 100 parâmetros por query: atualiza em blocos.
      for (let i = 0; i < descendants.length; i += 80) {
        queries.push(
          db
            .update(folders)
            .set({ depth: sql`${folders.depth} + ${delta}` })
            .where(inArray(folders.id, descendants.slice(i, i + 80))),
        );
      }
    }
    queries.push(
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'folder.updated',
        targetType: 'folder',
        targetId: folder.id,
      }),
    );
    await runBatch(db, queries);
    return c.json({
      folder: { id: folder.id, parentId: newParent, name: newName, depth: newDepth },
    });
  },
);

folderRoutes.delete(
  '/:workspaceId/folders/:folderId',
  requireWorkspacePermission('delete'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const folderId = c.req.param('folderId');
    const folder = (
      await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
        .limit(1)
    )[0];
    if (!folder) throw notFound();
    const child = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.workspaceId, workspaceId), eq(folders.parentId, folderId)))
      .limit(1);
    const doc = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.folderId, folderId)))
      .limit(1);
    if (child.length > 0 || doc.length > 0) {
      throw new AppError('CONFLICT', 409, 'A pasta não está vazia.');
    }
    await runBatch(db, [
      db.delete(folders).where(eq(folders.id, folderId)),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'folder.deleted',
        targetType: 'folder',
        targetId: folderId,
      }),
    ]);
    return c.json({ ok: true });
  },
);
