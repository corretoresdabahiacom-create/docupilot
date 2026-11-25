/** Papéis e matriz de permissões fixos (briefing §4). */
export const ROLES = ['owner', 'admin', 'manager', 'approver', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'read',
  'edit',
  'delete',
  'share',
  'export',
  'approve',
  'manage_members',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ['read', 'edit', 'delete', 'share', 'export', 'approve', 'manage_members'],
  admin: ['read', 'edit', 'delete', 'share', 'export', 'approve', 'manage_members'],
  manager: ['read', 'edit', 'delete', 'share', 'export', 'approve'],
  approver: ['read', 'export', 'approve'],
  editor: ['read', 'edit', 'export'],
  viewer: ['read'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Papéis que um convite ou uma alteração pode atribuir: `owner` nunca é atribuído (Fase 7). */
export const ASSIGNABLE_ROLES = ['admin', 'manager', 'approver', 'editor', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  approver: 2,
  editor: 1,
  viewer: 0,
};

/**
 * Quem tem `manage_members` só concede papéis ABAIXO do seu: o owner concede de admin para baixo;
 * o admin, de manager para baixo. Ninguém concede `owner`.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'manage_members') || target === 'owner') return false;
  return RANK[target] < RANK[actor];
}

/** Alterar ou remover um membro exige estar acima dele (o owner nunca é alterado por outro). */
export function canManageMember(actor: Role, member: Role): boolean {
  return can(actor, 'manage_members') && RANK[member] < RANK[actor];
}
