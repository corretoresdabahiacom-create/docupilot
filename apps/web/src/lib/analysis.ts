import { analyzePages, type PageText } from '@docupilot/shared';
import { api } from './api';
import { readAcroForm } from './extract/acroform';

interface PagesResponse {
  pages: Array<{ pageNumber: number; text: string }>;
  hasMore: boolean;
}

/** Busca o texto armazenado, 10 páginas por vez (limite do servidor). */
export async function fetchAllPages(
  workspaceId: string,
  documentId: string,
  versionId?: string,
): Promise<PageText[]> {
  const out: PageText[] = [];
  let from = 1;
  for (let guard = 0; guard < 40; guard++) {
    const res = await api<PagesResponse>(
      `/workspaces/${workspaceId}/documents/${documentId}/pages?from=${from}${
        versionId ? `&versionId=${versionId}` : ''
      }`,
    );
    out.push(...res.pages);
    const last = res.pages[res.pages.length - 1];
    if (!res.hasMore || !last) break;
    from = last.pageNumber + 1;
  }
  return out;
}

export interface AnalysisSaved {
  fields: number;
  inconsistencies: number;
  rejected: number;
}

/**
 * Analisa o texto já extraído NO NAVEGADOR e envia o resultado. O servidor reconfere cada campo
 * contra o texto armazenado; o que não conferir é descartado e contado em `rejected`.
 * `pdf` (opcional) permite ler os campos de formulário obrigatórios.
 */
export async function runAnalysis(
  workspaceId: string,
  doc: { documentId: string; versionId?: string; mime: string },
  pdf?: Blob,
): Promise<AnalysisSaved> {
  const pages = await fetchAllPages(workspaceId, doc.documentId, doc.versionId);
  const draft = analyzePages(pages, doc.documentId);
  const acroform =
    pdf && doc.mime === 'application/pdf' ? await readAcroForm(pdf).catch(() => []) : [];
  return api<AnalysisSaved>(`/workspaces/${workspaceId}/documents/${doc.documentId}/analysis`, {
    method: 'POST',
    body: {
      language: draft.language,
      simhash: draft.simhash,
      fields: draft.fields,
      candidates: draft.candidates,
      acroform,
      truncated: { fields: draft.truncatedFields, candidates: draft.truncatedCandidates },
    },
  });
}
