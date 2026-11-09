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
