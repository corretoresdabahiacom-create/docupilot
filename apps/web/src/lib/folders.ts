import type { FolderRow } from './api';

/** Caminho completo de cada pasta ("Contratos / 2026"), para selects e breadcrumbs. */
export function folderPaths(folders: FolderRow[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const f of folders) {
    const parts: string[] = [];
    let cur: FolderRow | undefined = f;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(f.id, parts.join(' / '));
  }
  return paths;
}

/** Cadeia de pastas da raiz até `folderId` (vazia na raiz). */
export function breadcrumb(folders: FolderRow[], folderId: string | null): FolderRow[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderRow[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  while (cur && chain.length < 10) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}
