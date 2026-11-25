import { sql } from 'drizzle-orm';
import { queryRows } from '../db/raw';
import { Hono } from 'hono';
import {
  extractTokens,
  searchQuerySchema,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  toTsQuery,
} from '@docupilot/shared';
import { AppError } from '../errors';
import { getFolderAccess } from '../access';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import type { AppVariables, Db } from '../types';

export const searchRoutes = new Hono<{ Variables: AppVariables }>();
searchRoutes.use('*', requireAuth);

export interface SearchHit {
  documentId: string;
  documentName: string;
  folderId: string | null;
  pageNumber: number;
  pageKind: string;
  snippet: string;
}

interface Params {
  workspaceId: string;
  q: string;
  folderId?: string;
  documentId?: string;
  limit: number;
  offset: number;
  hiddenFolderIds?: string[];
}

type Row = {
  document_id: string;
  document_name: string;
  folder_id: string | null;
  page_number: number;
  page_kind: string | null;
  snippet?: string;
  text?: string;
};

function folderClause(p: Params) {
  const { folderId, documentId, hiddenFolderIds = [] } = p;
  const parts = [];
  // Pastas restritas às quais o usuário não tem acesso (Fase 7).
  if (hiddenFolderIds.length > 0) {
    parts.push(
      sql`AND (d.folder_id IS NULL OR d.folder_id NOT IN (${sql.join(
        hiddenFolderIds.map((id) => sql`${id}`),
        sql`, `,
      )}))`,
    );
  }
  if (folderId)
    parts.push(
      folderId === 'root' ? sql`AND d.folder_id IS NULL` : sql`AND d.folder_id = ${folderId}`,
    );
  if (documentId) parts.push(sql`AND d.id = ${documentId}`);
  return parts.length ? sql.join(parts, sql` `) : sql``;
}

/**
 * Busca textual do Postgres (`text_search` = tsvector 'simple' sobre o texto sem acento e em
 * minúsculas, migração 0001). Só páginas da versão atual de cada documento. O trecho destacado é
 * montado aqui (JS) para marcar o termo mesmo quando o texto original tem acento.
 */
export async function searchFts(db: Db, p: Params): Promise<SearchHit[]> {
  const match = toTsQuery(p.q);
  if (!match) return [];
  const tokens = extractTokens(p.q);
  const rows = await queryRows<Row>(
    db,
    sql`
    SELECT p.document_id AS document_id, d.name AS document_name, d.folder_id AS folder_id,
           p.page_number AS page_number, dm.page_kind AS page_kind, p.text AS text
    FROM document_pages p
    JOIN documents d ON d.id = p.document_id AND d.current_version_id = p.version_id
    LEFT JOIN document_metadata dm ON dm.document_id = d.id
    WHERE p.workspace_id = ${p.workspaceId}
      AND p.text_search @@ to_tsquery('simple', f_unaccent(lower(${match})))
      ${folderClause(p)}
    ORDER BY ts_rank(p.text_search, to_tsquery('simple', f_unaccent(lower(${match})))) DESC,
             d.name, p.page_number
    LIMIT ${p.limit} OFFSET ${p.offset}`,
  );
  return rows.map((r) => toHit({ ...r, snippet: buildSnippet(r.text ?? '', tokens) }));
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Minúsculas e sem acento, mantendo o comprimento (cada caractere vira o caractere-base). */
function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD')[0] ?? ch;
    out += base.toLocaleLowerCase().length === 1 ? base.toLocaleLowerCase() : base;
  }
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Trecho de ~120 caracteres ao redor da primeira ocorrência, com os termos marcados. */
export function buildSnippet(text: string, tokens: string[]): string {
  const lower = fold(text);
  let first = -1;
  for (const t of tokens) {
    const i = lower.indexOf(fold(t));
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  const start = Math.max(0, (first === -1 ? 0 : first) - 50);
  const end = Math.min(text.length, start + 140);
  let out = text.slice(start, end).replace(/\s+/g, ' ');
  // Marca por posição no texto sem acento (mesmo tamanho do original), preservando o original.
  const folded = fold(out);
  const marks: Array<[number, number]> = [];
  for (const t of tokens) {
    const ft = fold(t);
    if (!ft) continue;
    for (let i = folded.indexOf(ft); i !== -1; i = folded.indexOf(ft, i + ft.length)) {
      // Só início de palavra (a busca é por prefixo) e marca a palavra inteira.
      if (i > 0 && WORD_CHAR.test(folded[i - 1] ?? '')) continue;
      let e = i + ft.length;
      while (e < folded.length && WORD_CHAR.test(folded[e] ?? '')) e++;
      marks.push([i, e]);
    }
  }
  marks.sort((x, y) => x[0] - y[0]);
  let result = '';
  let cursor = 0;
  for (const [a, b] of marks) {
    if (a < cursor) continue;
    result += `${out.slice(cursor, a)}${SNIPPET_OPEN}${out.slice(a, b)}${SNIPPET_CLOSE}`;
    cursor = b;
  }
  out = result + out.slice(cursor);
  return `${start > 0 ? '…' : ''}${out}${end < text.length ? '…' : ''}`;
}

/** Alternativa sem o índice de texto (LIKE). Não ignora acentos e é mais lenta. */
export async function searchLike(db: Db, p: Params): Promise<SearchHit[]> {
  const tokens = extractTokens(p.q);
  if (tokens.length === 0) return [];
  const conds = tokens.map((t) => sql`p.text LIKE ${`%${escapeLike(t)}%`} ESCAPE '\\'`);
  const rows = await queryRows<Row>(
    db,
    sql`
    SELECT p.document_id AS document_id, d.name AS document_name, d.folder_id AS folder_id,
           p.page_number AS page_number, dm.page_kind AS page_kind, p.text AS text
    FROM document_pages p
    JOIN documents d ON d.id = p.document_id AND d.current_version_id = p.version_id
    LEFT JOIN document_metadata dm ON dm.document_id = d.id
    WHERE p.workspace_id = ${p.workspaceId} AND ${sql.join(conds, sql` AND `)}
      ${folderClause(p)}
    ORDER BY d.name, p.page_number
    LIMIT ${p.limit} OFFSET ${p.offset}`,
  );
  return rows.map((r) => toHit({ ...r, snippet: buildSnippet(r.text ?? '', tokens) }));
}

function toHit(r: Row): SearchHit {
  return {
    documentId: r.document_id,
    documentName: r.document_name,
    folderId: r.folder_id,
    pageNumber: r.page_number,
    pageKind: r.page_kind ?? 'page',
    snippet: r.snippet ?? '',
  };
}

searchRoutes.get('/:workspaceId/search', requireWorkspacePermission('read'), async (c) => {
  const parsed = searchQuerySchema.safeParse(c.req.query());
  if (!parsed.success || !toTsQuery(parsed.data.q)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Consulta de busca inválida.');
  }
  const { db } = c.get('deps');
  const params = {
    workspaceId: c.get('member').workspaceId,
    hiddenFolderIds: (await getFolderAccess(c)).hiddenIds,
    ...parsed.data,
    // Pede um a mais para saber se há próxima página.
    limit: parsed.data.limit + 1,
  };
  let mode: 'fts' | 'like' = 'fts';
  let hits: SearchHit[];
  try {
    hits = await searchFts(db, params);
  } catch (err) {
    // Só cai para LIKE quando a coluna/função de busca não existe no banco; outros erros sobem.
    const msg = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (!/text_search|f_unaccent|does not exist/i.test(msg)) throw err;
    mode = 'like';
    hits = await searchLike(db, params);
  }
  const hasMore = hits.length > parsed.data.limit;
  return c.json({ mode, hasMore, results: hits.slice(0, parsed.data.limit) });
});
