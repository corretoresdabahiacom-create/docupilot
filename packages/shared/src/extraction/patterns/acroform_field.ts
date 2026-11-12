/**
 * Pattern acroform_field — docs/heuristics.md §10.1.
 * Descreve os campos de um formulário AcroForm a partir do que o leitor de PDF (pdf-lib, no
 * navegador) informa: tipo, opções, tamanho máximo, obrigatório, somente leitura. Só ENTENDE a
 * estrutura do PDF; não adivinha o que cada campo significa (isso é `acroform_type_mapping`).
 */

export const PATTERN_ID = 'acroform_field' as const;

export type PdfFieldType =
  'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature' | 'unknown';

/** O que o adaptador de PDF entrega, sem depender de nenhuma biblioteca. */
export interface RawFormField {
  /** Nome qualificado completo ("Pessoa.CPF"). */
  name: string;
  pdfType: PdfFieldType;
  options?: string[];
  maxLength?: number;
  multiline?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Valor atual no PDF. */
  value?: string | boolean | string[] | null;
}

export type FieldKind = 'text' | 'checkbox' | 'choice' | 'unsupported';
export type UnsupportedReason = 'signature' | 'button' | 'read_only' | 'unknown';

export interface FormField {
  name: string;
  /** Último trecho do nome, normalizado ("pessoa.cpf[0]" → "cpf"). */
  leaf: string;
  /** Segmentos anteriores ao último, normalizados (contexto: "conjuge", "titular"…). */
  parents: string[];
  kind: FieldKind;
  pdfType: PdfFieldType;
  options: string[];
  maxLength: number | null;
  multiline: boolean;
  required: boolean;
  /** Já veio com valor no PDF. */
  filled: boolean;
  unsupportedReason: UnsupportedReason | null;
}

export const MAX_FORM_FIELDS = 500;

/** minúsculas, sem acento, sem sufixo de índice `[0]`, só [a-z0-9_]. */
export function normalizeSegment(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[\d+\]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Divide "Pessoa[0].Dados.CPF" em segmentos normalizados, descartando os vazios. */
export function nameSegments(name: string): string[] {
  return name
    .split('.')
    .map(normalizeSegment)
    .filter((s) => s !== '');
}

function isFilled(value: RawFormField['value']): boolean {
  if (Array.isArray(value)) return value.some((v) => v.trim() !== '');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim() !== '' && value.toLowerCase() !== 'off';
  return false;
}

export function describeField(raw: RawFormField): FormField {
  const segs = nameSegments(raw.name);
  const leaf = segs.at(-1) ?? '';
  const base = {
    name: raw.name,
    leaf,
    parents: segs.slice(0, -1),
    pdfType: raw.pdfType,
    options: (raw.options ?? []).filter((o) => o !== ''),
    maxLength: raw.maxLength && raw.maxLength > 0 ? raw.maxLength : null,
    multiline: Boolean(raw.multiline),
    required: Boolean(raw.required),
    filled: isFilled(raw.value),
  };
  const unsupported = (reason: UnsupportedReason): FormField => ({
    ...base,
    kind: 'unsupported',
    unsupportedReason: reason,
  });
  if (raw.pdfType === 'signature') return unsupported('signature');
  if (raw.pdfType === 'button') return unsupported('button');
  if (raw.pdfType === 'unknown') return unsupported('unknown');
  if (raw.readOnly) return unsupported('read_only');
  const kind: FieldKind =
    raw.pdfType === 'text' ? 'text' : raw.pdfType === 'checkbox' ? 'checkbox' : 'choice'; // radio, dropdown, list
  return { ...base, kind, unsupportedReason: null };
}

/** Campos do formulário, na ordem do PDF, até MAX_FORM_FIELDS. Nomes repetidos são mantidos. */
export function describeFields(raw: RawFormField[]): FormField[] {
  return raw.slice(0, MAX_FORM_FIELDS).map(describeField);
}
