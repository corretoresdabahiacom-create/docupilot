import { MAX_CHARS_PER_REQUEST, MAX_PAGES_PER_REQUEST } from '@docupilot/shared';
import { api, ApiError } from '../api';
import type { ExtractedBy, ExtractedPage, ExtractionResult } from './types';

export interface DocumentIds {
  workspaceId: string;
  documentId: string;
  versionId: string;
}

/** Agrupa páginas respeitando o limite de páginas e de caracteres por requisição. Páginas vazias saem. */
export function batchPages(
  pages: ExtractedPage[],
  maxPages = MAX_PAGES_PER_REQUEST,
  maxChars = MAX_CHARS_PER_REQUEST,
): ExtractedPage[][] {
  const batches: ExtractedPage[][] = [];
  let current: ExtractedPage[] = [];
  let chars = 0;
  for (const page of pages) {
    if (page.text.trim().length === 0) continue;
    if (current.length > 0 && (current.length >= maxPages || chars + page.text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(page);
    chars += page.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const base = (ids: DocumentIds) =>
  `/workspaces/${ids.workspaceId}/documents/${ids.documentId}/versions/${ids.versionId}`;

/** Envia o texto em lotes e finaliza a extração. Devolve o estado gravado no servidor. */
export async function submitExtraction(
  ids: DocumentIds,
  result: ExtractionResult,
  extractedBy: ExtractedBy,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionResult['status']> {
  if (result.status !== 'extracted') {
    await api(`${base(ids)}/extraction/complete`, {
      method: 'POST',
      body: { status: result.status, pageCount: result.pageCount },
    });
    return result.status;
  }
  const batches = batchPages(result.pages);
  onProgress?.(0, batches.length);
  try {
    for (const [i, pages] of batches.entries()) {
      await api(`${base(ids)}/pages`, { method: 'PUT', body: { pages, extractedBy } });
      onProgress?.(i + 1, batches.length);
    }
    await api(`${base(ids)}/extraction/complete`, {
      method: 'POST',
      body: {
        status: 'extracted',
        pageCount: result.pageCount,
        pageKind: result.pageKind,
        extractedBy,
      },
    });
    return 'extracted';
  } catch (err) {
    // O servidor recusou o texto como corrompido: registra como falha em vez de deixar pendente.
    if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
      await api(`${base(ids)}/extraction/complete`, {
        method: 'POST',
        body: { status: 'extraction_failed', pageCount: result.pageCount },
      });
      return 'extraction_failed';
    }
    throw err;
  }
}
