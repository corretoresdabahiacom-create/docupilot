import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { documents } from '../db/schema';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import type { AppVariables } from '../types';

export const workspaceRoutes = new Hono<{ Variables: AppVariables }>();

workspaceRoutes.use('*', requireAuth);

workspaceRoutes.get('/:workspaceId/documents', requireWorkspacePermission('read'), async (c) => {
  const rows = await c
    .get('deps')
    .db.select({
      id: documents.id,
      name: documents.name,
      mime: documents.mime,
      status: documents.status,
      folderId: documents.folderId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.workspaceId, c.get('member').workspaceId))
    .orderBy(desc(documents.createdAt))
    .limit(200);
  return c.json({ documents: rows });
});
