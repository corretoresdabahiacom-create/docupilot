import {
  compare,
  comparisonRows,
  toCsv,
  toJson,
  toMarkdown,
  exportFileName,
  type ComparisonResult,
  type ExportFormat,
  type ExportLabels,
  type ExportMeta,
} from '@docupilot/shared';
import { fetchAllPages } from './analysis';

export interface CompareSide {
  documentId: string;
  versionId: string;
}

/** Um dos lados não tem texto extraído; `side` diz qual. */
export class NoTextError extends Error {
  constructor(public readonly side: 'a' | 'b') {
    super(`NO_TEXT_${side.toUpperCase()}`);
  }
}

/**
 * Baixa o texto já armazenado das duas versões (10 páginas por requisição) e compara NO
 * NAVEGADOR. Nada é gravado: o resultado só existe nesta tela e nos arquivos exportados.
 */
export async function loadAndCompare(
  workspaceId: string,
  a: CompareSide,
  b: CompareSide,
): Promise<ComparisonResult> {
  const [pa, pb] = await Promise.all([
    fetchAllPages(workspaceId, a.documentId, a.versionId),
    fetchAllPages(workspaceId, b.documentId, b.versionId),
  ]);
  if (pa.length === 0) throw new NoTextError('a');
  if (pb.length === 0) throw new NoTextError('b');
  return compare(pa, pb);
}

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
};

export function buildExport(
  result: ComparisonResult,
  format: ExportFormat,
  meta: ExportMeta,
  labels: ExportLabels,
): string {
  if (format === 'json') return toJson(result, meta);
  const rows = comparisonRows(result);
  return format === 'csv' ? toCsv(rows, labels) : toMarkdown(rows, meta, labels);
}

/** Entrega o arquivo pelo navegador (Blob local; nada vai para o servidor). */
export function downloadExport(
  result: ComparisonResult,
  format: ExportFormat,
  meta: ExportMeta,
  labels: ExportLabels,
): void {
  const blob = new Blob([buildExport(result, format, meta, labels)], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(`${meta.leftLabel}-vs-${meta.rightLabel}`, format);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
