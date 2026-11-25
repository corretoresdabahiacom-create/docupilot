import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Permission, Role } from '@docupilot/shared';
import { documents, folderMembers, folders } from './db/schema';
import { forbidden, notFound } from './errors';
import type { AppVariables, Db } from './types';

/**
 * Acesso por pasta (Fase 7). Uma pasta `restricted` (e toda a sua subárvore) só é vista por
 * owner/admin/manager e por membros com concessão em `folder_members`. A concessão herda para
 * as subpastas; o nível efetivo é o MENOR entre as concessões das pastas restritas do caminho.
 * O papel do workspace continua valendo: a concessão `edit` não dá a quem é `viewer` o direito de
 * editar. Documentos sem pasta não são restritos.
 */
export type FolderLevel = 'none' | 'view' | 'edit';

export interface FolderAccess {
  /** owner/admin/manager enxergam tudo. */
  privileged: boolean;
  level(folderId: string | null | undefined): FolderLevel;
  /** Ids de pastas que o usuário NÃO vê (para filtrar consultas). Vazio = sem filtro. */
  hiddenIds: string[];
}

const PRIVILEGED: readonly Role[] = ['owner', 'admin', 'manager'];
/** Permissões que alteram dados: exigem nível `edit` na pasta. */
const MUTATING: readonly Permission[] = ['edit', 'delete', 'share', 'manage_members'];

export async function computeFolderAccess(
  db: Db,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<FolderAccess> {
  if (PRIVILEGED.includes(role)) {
    return { privileged: true, level: () => 'edit', hiddenIds: [] };
  }
  const all = await db
    .select({ id: folders.id, parentId: folders.parentId, restricted: folders.restricted })
    .from(folders)
    .where(eq(folders.workspaceId, workspaceId));
  const restrictedIds = all.filter((f) => f.restricted).map((f) => f.id);
  const grants = new Map<string, 'view' | 'edit'>();
  if (restrictedIds.length > 0) {
    const rows = await db
      .select({ folderId: folderMembers.folderId, access: folderMembers.access })
      .from(folderMembers)
      .where(eq(folderMembers.userId, userId));
    for (const r of rows) {
      if (restrictedIds.includes(r.folderId) && (r.access === 'view' || r.access === 'edit')) {
        grants.set(r.folderId, r.access);
      }
    }
  }
  const byId = new Map(all.map((f) => [f.id, f]));
  const levels = new Map<string, FolderLevel>();
  const compute = (id: string, guard = 0): FolderLevel => {
    const cached = levels.get(id);
    if (cached) return cached;
    const f = byId.get(id);
    // Pasta desconhecida (outro workspace) ou ciclo inesperado: nega.
    if (!f || guard > 10) return 'none';
    const parentLevel: FolderLevel = f.parentId ? compute(f.parentId, guard + 1) : 'edit';
    let level = parentLevel;
    if (f.restricted && level !== 'none') {
      const g = grants.get(f.id);
      // Concessão na própria pasta; sem ela, herda a concessão mais próxima acima.
      const inherited = g ?? nearestGrant(f.parentId, byId, grants);
      if (!inherited) level = 'none';
      else level = min(level, inherited);
    }
    levels.set(id, level);
    return level;
  };
  const hiddenIds: string[] = [];
  for (const f of all) if (compute(f.id) === 'none') hiddenIds.push(f.id);
  return {
    privileged: false,
    hiddenIds,
    level: (id) => (id ? compute(id) : 'edit'),
  };
}

function min(a: FolderLevel, b: FolderLevel): FolderLevel {
  const order: FolderLevel[] = ['none', 'view', 'edit'];
  return order[Math.min(order.indexOf(a), order.indexOf(b))] ?? 'none';
}

function nearestGrant(
  parentId: string | null,
  byId: Map<string, { id: string; parentId: string | null; restricted: boolean }>,
  grants: Map<string, 'view' | 'edit'>,
): 'view' | 'edit' | undefined {
  let cur = parentId;
  for (let i = 0; cur && i < 10; i++) {
    const g = grants.get(cur);
    if (g) return g;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return undefined;
}

type Ctx = Context<{ Variables: AppVariables }>;

/** Acesso do usuário da requisição (calculado uma vez por requisição). */
export async function getFolderAccess(c: Ctx): Promise<FolderAccess> {
  const cached = c.get('folderAccess');
  if (cached) return cached;
  const member = c.get('member');
  const access = await computeFolderAccess(
    c.get('deps').db,
    member.workspaceId,
    c.get('user').id,
    member.role,
  );
  c.set('folderAccess', access);
  return access;
}

/** 404 se a pasta está oculta; 403 se a ação altera dados e a concessão é só de leitura. */
export async function assertFolderAccess(
  c: Ctx,
  folderId: string | null | undefined,
  permission?: Permission,
): Promise<void> {
  const access = await getFolderAccess(c);
  const level = access.level(folderId);
  if (level === 'none') throw notFound();
  const needed = permission ?? c.get('member').permission;
  if (level === 'view' && needed && MUTATING.includes(needed)) throw forbidden();
}

/** Documento do workspace da requisição, já com a checagem de acesso por pasta. */
export async function loadAccessibleDocument(c: Ctx, documentId: string) {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!doc) throw notFound();
  await assertFolderAccess(c, doc.folderId);
  return doc;
}
