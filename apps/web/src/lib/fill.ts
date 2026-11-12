import { sourcesFromExtracted, type DataSource } from '@docupilot/shared';
import { api, type AnalysisResponse, type ProfileData } from './api';

/** Lê (e audita no servidor) o perfil escolhido. Só é chamado por ação explícita da pessoa. */
export const loadProfile = (id: string) => api<ProfileData>(`/me/profiles/${id}`);

/** Dados que a análise (Fase 3) já extraiu dos documentos de referência escolhidos. */
export async function loadReferenceSources(
  workspaceId: string,
  docs: Array<{ id: string; name: string }>,
): Promise<DataSource[]> {
  const out: DataSource[] = [];
  const now = new Date();
  for (const doc of docs) {
    const res = await api<AnalysisResponse>(
      `/workspaces/${workspaceId}/documents/${doc.id}/analysis`,
    );
    out.push(...sourcesFromExtracted(res.fields, doc, now));
  }
  return out;
}

/** Baixa um arquivo gerado no navegador. */
export function saveBlob(bytes: Uint8Array | string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nome seguro para o arquivo gerado. */
export function filledFileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return `${base || 'formulario'}-preenchido.pdf`;
}
