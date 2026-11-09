import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { can, isRole, type Permission } from '@docupilot/shared';
import { workspaceMembers } from '../db/schema';
import { forbidden, notFound } from '../errors';
import type { AppVariables } from '../types';

/**
 * user → workspace → permissão. Quem não é membro recebe 404 (não revela a existência do
 * workspace); quem é membro sem a permissão recebe 403.
 */
export function requireWorkspacePermission(
  permission: Permission,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const workspaceId = c.req.param('workspaceId');
    if (!workspaceId) throw notFound();
    const user = c.get('user');
    const rows = await c
      .get('deps')
      .db.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
      )
      .limit(1);
    const role = rows[0]?.role;
    if (!role || !isRole(role)) throw notFound();
    if (!can(role, permission)) throw forbidden();
    c.set('member', { workspaceId, role });
    return next();
  };
}
