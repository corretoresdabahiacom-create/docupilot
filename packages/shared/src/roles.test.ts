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
