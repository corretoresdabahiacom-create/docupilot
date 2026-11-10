import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  extractTokens,
  searchQuerySchema,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  toFtsQuery,
} from '@docupilot/shared';
import { AppError } from '../errors';
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

function folderClause(folderId?: string, documentId?: string) {
  const parts = [];
  if (folderId)
    parts.push(
      folderId === 'root' ? sql`AND d.folder_id IS NULL` : sql`AND d.folder_id = ${folderId}`,
    );
  if (documentId) parts.push(sql`AND d.id = ${documentId}`);
  return parts.length ? sql.join(parts, sql` `) : sql``;
}

/** FTS5 (bm25 + snippet). Só páginas da versão atual de cada documento. */
export async function searchFts(db: Db, p: Params): Promise<SearchHit[]> {
  const match = toFtsQuery(p.q);
  if (!match) return [];
  const rows = await db.all<Row>(sql`
    SELECT p.document_id AS document_id, d.name AS document_name, d.folder_id AS folder_id,
           p.page_number AS page_number, dm.page_kind AS page_kind,
           snippet(document_pages_fts, 0, char(1), char(2), '…', 16) AS snippet
    FROM document_pages_fts
    JOIN document_pages p ON p.id = document_pages_fts.rowid
    JOIN documents d ON d.id = p.document_id AND d.current_version_id = p.version_id
    LEFT JOIN document_metadata dm ON dm.document_id = d.id
    WHERE document_pages_fts MATCH ${match} AND p.workspace_id = ${p.workspaceId}
      ${folderClause(p.folderId, p.documentId)}
    ORDER BY bm25(document_pages_fts), d.name, p.page_number
    LIMIT ${p.limit} OFFSET ${p.offset}`);
  return rows.map(toHit);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Trecho de ~120 caracteres ao redor da primeira ocorrência, com os termos marcados. */
export function buildSnippet(text: string, tokens: string[]): string {
  const lower = text.toLocaleLowerCase();
  let first = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLocaleLowerCase());
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  const start = Math.max(0, (first === -1 ? 0 : first) - 50);
  const end = Math.min(text.length, start + 140);
  let out = text.slice(start, end).replace(/\s+/g, ' ');
  for (const t of tokens) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    out = out.replace(re, (m) => `${SNIPPET_OPEN}${m}${SNIPPET_CLOSE}`);
  }
  return `${start > 0 ? '…' : ''}${out}${end < text.length ? '…' : ''}`;
}

/** Alternativa sem FTS5 (LIKE). Não ignora acentos e é mais lenta. */
export async function searchLike(db: Db, p: Params): Promise<SearchHit[]> {
  const tokens = extractTokens(p.q);
  if (tokens.length === 0) return [];
  const conds = tokens.map((t) => sql`p.text LIKE ${`%${escapeLike(t)}%`} ESCAPE '\\'`);
  const rows = await db.all<Row>(sql`
    SELECT p.document_id AS document_id, d.name AS document_name, d.folder_id AS folder_id,
           p.page_number AS page_number, dm.page_kind AS page_kind, p.text AS text
    FROM document_pages p
    JOIN documents d ON d.id = p.document_id AND d.current_version_id = p.version_id
    LEFT JOIN document_metadata dm ON dm.document_id = d.id
    WHERE p.workspace_id = ${p.workspaceId} AND ${sql.join(conds, sql` AND `)}
      ${folderClause(p.folderId, p.documentId)}
    ORDER BY d.name, p.page_number
    LIMIT ${p.limit} OFFSET ${p.offset}`);
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
  if (!parsed.success || !toFtsQuery(parsed.data.q)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Consulta de busca inválida.');
  }
  const { db } = c.get('deps');
  const params = {
    workspaceId: c.get('member').workspaceId,
    ...parsed.data,
    // Pede um a mais para saber se há próxima página.
    limit: parsed.data.limit + 1,
  };
  let mode: 'fts' | 'like' = 'fts';
  let hits: SearchHit[];
  try {
    hits = await searchFts(db, params);
  } catch (err) {
    // Só cai para LIKE quando o FTS5 não existe no banco; outros erros sobem.
    const msg = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (!/no such (table|module)|fts5/i.test(msg)) throw err;
    mode = 'like';
    hits = await searchLike(db, params);
  }
  const hasMore = hits.length > parsed.data.limit;
  return c.json({ mode, hasMore, results: hits.slice(0, parsed.data.limit) });
});
