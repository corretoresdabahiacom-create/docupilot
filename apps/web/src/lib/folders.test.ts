import { describe, expect, it } from 'vitest';
import { breadcrumb, folderPaths } from './folders';

const folders = [
  { id: 'a', parentId: null, name: 'Contratos', depth: 1 },
  { id: 'b', parentId: 'a', name: '2026', depth: 2 },
  { id: 'c', parentId: 'b', name: 'Locação', depth: 3 },
];

describe('pastas', () => {
  it('monta caminhos completos', () => {
    const p = folderPaths(folders);
    expect(p.get('c')).toBe('Contratos / 2026 / Locação');
    expect(p.get('a')).toBe('Contratos');
  });
  it('monta o breadcrumb da raiz até a pasta', () => {
    expect(breadcrumb(folders, 'c').map((f) => f.name)).toEqual(['Contratos', '2026', 'Locação']);
    expect(breadcrumb(folders, null)).toEqual([]);
    expect(breadcrumb(folders, 'inexistente')).toEqual([]);
  });
  it('não entra em loop com dados cíclicos', () => {
    const loop = [
      { id: 'x', parentId: 'y', name: 'x', depth: 1 },
      { id: 'y', parentId: 'x', name: 'y', depth: 1 },
    ];
    expect(folderPaths(loop).get('x')).toBeTruthy();
    expect(breadcrumb(loop, 'x').length).toBeLessThanOrEqual(10);
  });
});
