import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, can } from './roles';

// Matriz do briefing §4 (✔ = true).
const EXPECTED: Record<string, Record<string, boolean>> = {
  owner: {
    read: true,
    edit: true,
    delete: true,
    share: true,
    export: true,
    approve: true,
    manage_members: true,
  },
  admin: {
    read: true,
    edit: true,
    delete: true,
    share: true,
    export: true,
    approve: true,
    manage_members: true,
  },
  manager: {
    read: true,
    edit: true,
    delete: true,
    share: true,
    export: true,
    approve: true,
    manage_members: false,
  },
  approver: {
    read: true,
    edit: false,
    delete: false,
    share: false,
    export: true,
    approve: true,
    manage_members: false,
  },
  editor: {
    read: true,
    edit: true,
    delete: false,
    share: false,
    export: true,
    approve: false,
    manage_members: false,
  },
  viewer: {
    read: true,
    edit: false,
    delete: false,
    share: false,
    export: false,
    approve: false,
    manage_members: false,
  },
};

describe('matriz de permissões', () => {
  for (const role of ROLES) {
    for (const perm of PERMISSIONS) {
      it(`${role} / ${perm} = ${EXPECTED[role]![perm]}`, () => {
        expect(can(role, perm)).toBe(EXPECTED[role]![perm]);
      });
    }
  }
});

describe('regras de gestão de membros (Fase 7)', () => {
  it('owner concede de admin para baixo; nunca owner', async () => {
    const { canAssignRole } = await import('./roles');
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'viewer')).toBe(true);
    expect(canAssignRole('owner', 'owner')).toBe(false);
  });
  it('admin concede de manager para baixo; não concede admin', async () => {
    const { canAssignRole } = await import('./roles');
    expect(canAssignRole('admin', 'manager')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(false);
  });
  it('papéis sem manage_members não concedem nada', async () => {
    const { canAssignRole, canManageMember } = await import('./roles');
    for (const r of ['manager', 'approver', 'editor', 'viewer'] as const) {
      expect(canAssignRole(r, 'viewer')).toBe(false);
      expect(canManageMember(r, 'viewer')).toBe(false);
    }
  });
  it('admin não altera owner nem outro admin; owner altera admin', async () => {
    const { canManageMember } = await import('./roles');
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('admin', 'editor')).toBe(true);
    expect(canManageMember('owner', 'admin')).toBe(true);
    expect(canManageMember('owner', 'owner')).toBe(false);
  });
});
