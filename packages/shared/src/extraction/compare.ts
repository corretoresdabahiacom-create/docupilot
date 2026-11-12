/**
 * Comparação de dois textos extraídos (Fase 4): texto, campos e cláusulas.
 * Função pura, executada no navegador. Compara o que está escrito; não emite juízo sobre
 * validade, efeito ou legalidade de nada.
 */
import type { PageText } from './analyze';
import { diffClauses, type ClauseComparison } from './patterns/diff_clause';
import { diffFields, type ComparedField } from './patterns/diff_fields';
import { diffText, type TextDiff } from './patterns/diff_textual';

export interface ComparisonResult {
  text: TextDiff;
  fields: ComparedField[];
  clauses: ClauseComparison;
}

export function compare(a: PageText[], b: PageText[]): ComparisonResult {
  return { text: diffText(a, b), fields: diffFields(a, b), clauses: diffClauses(a, b) };
}

// ---------- exportação ----------

export const EXPORT_FORMATS = ['csv', 'json', 'md'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface TableRow {
  section: 'campo' | 'clausula';
  item: string;
  status: string;
  valueA: string;
  originA: string;
  valueB: string;
  originB: string;
}

export interface ExportMeta {
  leftLabel: string;
  rightLabel: string;
  /** ISO 8601. */
  generatedAt: string;
  /** Aviso fixo (já traduzido): heurística, sem parecer jurídico. */
  notice: string;
}

export interface ExportLabels {
  section: string;
  item: string;
  status: string;
  valueA: string;
  originA: string;
  valueB: string;
  originB: string;
}

export const DEFAULT_LABELS: ExportLabels = {
  section: 'seção',
  item: 'item',
  status: 'situação',
  valueA: 'valor A',
  originA: 'origem A',
  valueB: 'valor B',
  originB: 'origem B',
};

const pages = (list: Array<{ pageNumber: number }>): string => {
  const uniq = [...new Set(list.map((s) => s.pageNumber))].sort((x, y) => x - y);
  return uniq.map((n) => `p.${n}`).join('; ');
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function comparisonRows(result: ComparisonResult): TableRow[] {
  const rows: TableRow[] = [];
  for (const f of result.fields) {
    rows.push({
      section: 'campo',
      item: f.label ? `${f.fieldType} — ${f.label}` : f.fieldType,
      status: f.status,
      valueA: f.a?.normalized ?? '',
      originA: f.a ? pages(f.a.sources) : '',
      valueB: f.b?.normalized ?? '',
      originB: f.b ? pages(f.b.sources) : '',
    });
  }
  for (const c of result.clauses.clauses) {
    rows.push({
      section: 'clausula',
      item:
        c.keyA && c.keyB && c.keyA !== c.keyB ? `${c.keyA} → ${c.keyB}` : (c.keyB ?? c.keyA ?? ''),
      status: c.status,
      valueA: c.a ? clip(c.a.text, 300) : '',
      originA: c.a ? `p.${c.a.pageNumber}` : '',
      valueB: c.b ? clip(c.b.text, 300) : '',
      originB: c.b ? `p.${c.b.pageNumber}` : '',
    });
  }
  return rows;
}

/** Marca de ordem de bytes UTF-8 (montada por código para o formatador não a reescrever). */
const BOM = String.fromCharCode(0xfeff);

/**
 * Valores vêm de documentos de terceiros: células que começam com = + - @ (ou tab/CR) seriam
 * lidas como fórmula pelo Excel/Sheets; o apóstrofo as neutraliza.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV com BOM UTF-8 (o Excel só reconhece acentos assim) e quebras CRLF. */
export function toCsv(rows: TableRow[], labels: ExportLabels = DEFAULT_LABELS): string {
  const head = [
    labels.section,
    labels.item,
    labels.status,
    labels.valueA,
    labels.originA,
    labels.valueB,
    labels.originB,
  ];
  const lines = [
    head,
    ...rows.map((r) => [r.section, r.item, r.status, r.valueA, r.originA, r.valueB, r.originB]),
  ];
  return `${BOM}${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const mdCell = (s: string) =>
  s
    .replace(/[\\|<>[\]`*_]/g, (m) => `\\${m}`)
    .replace(/\s+/g, ' ')
    .trim();

export function toMarkdown(
  rows: TableRow[],
  meta: ExportMeta,
  labels: ExportLabels = DEFAULT_LABELS,
): string {
  const head = [
    labels.section,
    labels.item,
    labels.status,
    labels.valueA,
    labels.originA,
    labels.valueB,
    labels.originB,
  ];
  const out = [
    `# ${mdCell(meta.leftLabel)} × ${mdCell(meta.rightLabel)}`,
    '',
    `> ${mdCell(meta.notice)}`,
    '',
    `_${meta.generatedAt}_`,
    '',
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (r) =>
        `| ${[r.section, r.item, r.status, r.valueA, r.originA, r.valueB, r.originB].map(mdCell).join(' | ')} |`,
    ),
    '',
  ];
  return out.join('\n');
}

/** JSON completo, sem as partes iguais do diff de texto (que seriam o documento inteiro). */
export function toJson(result: ComparisonResult, meta: ExportMeta): string {
  const { hunks, ...textRest } = result.text;
  return JSON.stringify(
    {
      meta,
      method: ['diff_textual', 'diff_fields', 'diff_clause'],
      text: { ...textRest, changes: hunks.filter((h) => h.kind !== 'equal') },
      fields: result.fields,
      clauses: result.clauses,
      table: comparisonRows(result),
    },
    null,
    2,
  );
}

/** Nome de arquivo seguro (sem caminho, sem caracteres especiais). */
export function exportFileName(base: string, ext: ExportFormat): string {
  const clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|-+$/g, '')
    .slice(0, 60);
  return `${clean || 'comparacao'}.${ext}`;
}
