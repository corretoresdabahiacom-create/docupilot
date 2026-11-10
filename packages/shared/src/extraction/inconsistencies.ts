/**
 * Regras de inconsistência (docs/heuristics.md §15). Cada achado traz as evidências
 * (página + trecho) e uma categoria; nada aqui é julgamento jurídico.
 */
export const CATEGORIES = [
  'erro_confirmado_por_regra',
  'divergencia_identificada',
  'exige_revisao_humana',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const RULES = {
  date_conflict_same_label: 'erro_confirmado_por_regra',
  money_conflict_same_label: 'erro_confirmado_por_regra',
  empty_required_acroform: 'erro_confirmado_por_regra',
  missing_annex_reference: 'exige_revisao_humana',
  duplicate_exact: 'erro_confirmado_por_regra',
  duplicate_similar: 'divergencia_identificada',
  cpf_cnpj_dv_invalid: 'erro_confirmado_por_regra',
} as const satisfies Record<string, Category>;
export type RuleId = keyof typeof RULES;

export interface Evidence {
  pageNumber: number;
  start: number;
  end: number;
  raw: string;
}

export interface Finding {
  ruleId: RuleId;
  category: Category;
  evidence: Evidence[];
  /** Dados curtos para a mensagem (rótulo, valores, nome do anexo…). */
  detail: Record<string, string>;
}

/**
 * Rótulos de valor ÚNICO por documento. Só estes entram nas regras de conflito: rótulos
 * genéricos ("Valor:", "Data:") aparecem legitimamente várias vezes e gerariam falsos erros.
 */
export const SINGLE_VALUE_DATE_LABELS = new Set([
  'vencimento',
  'data de vencimento',
  'data vencimento',
  'emissao',
  'data de emissao',
  'data de assinatura',
  'assinatura',
  'data de nascimento',
  'nascimento',
  'data de inicio',
  'inicio',
  'data de termino',
  'termino',
  'validade',
  'data de validade',
]);
export const SINGLE_VALUE_MONEY_LABELS = new Set([
  'total',
  'total geral',
  'valor total',
  'total a pagar',
  'valor do contrato',
  'valor global',
  'valor da nota',
  'valor liquido',
  'valor bruto',
]);

interface LabeledField {
  field_type: string;
  normalized_value: string;
  label?: string | null;
  page_number: number;
  text_span_start: number;
  text_span_end: number;
  raw_value: string;
}

function conflicts(
  fields: LabeledField[],
  type: string,
  allowed: Set<string>,
  ruleId: 'date_conflict_same_label' | 'money_conflict_same_label',
): Finding[] {
  const groups = new Map<string, LabeledField[]>();
  for (const f of fields) {
    if (f.field_type !== type || !f.label || !allowed.has(f.label)) continue;
    const arr = groups.get(f.label) ?? [];
    arr.push(f);
    groups.set(f.label, arr);
  }
  const out: Finding[] = [];
  for (const [label, unsorted] of groups) {
    const items = [...unsorted].sort(
      (a, b) => a.page_number - b.page_number || a.text_span_start - b.text_span_start,
    );
    const values = [...new Set(items.map((i) => i.normalized_value))].sort();
    if (values.length < 2) continue;
    out.push({
      ruleId,
      category: RULES[ruleId],
      evidence: items.slice(0, 6).map((i) => ({
        pageNumber: i.page_number,
        start: i.text_span_start,
        end: i.text_span_end,
        raw: i.raw_value,
      })),
      detail: { label, values: values.join(' | ') },
    });
  }
  return out;
}

export const detectDateConflicts = (fields: LabeledField[]) =>
  conflicts(fields, 'date', SINGLE_VALUE_DATE_LABELS, 'date_conflict_same_label');
export const detectMoneyConflicts = (fields: LabeledField[]) =>
  conflicts(fields, 'money', SINGLE_VALUE_MONEY_LABELS, 'money_conflict_same_label');

export interface AcroFormFieldInfo {
  pageNumber: number;
  name: string;
  required: boolean;
  filled: boolean;
}

/** Campo obrigatório vazio (dados lidos do próprio PDF pelo navegador; o servidor não os reconfere). */
export function detectEmptyRequiredAcroform(fields: AcroFormFieldInfo[]): Finding[] {
  return fields
    .filter((f) => f.required && !f.filled)
    .slice(0, 20)
    .map((f) => ({
      ruleId: 'empty_required_acroform' as const,
      category: RULES.empty_required_acroform,
      evidence: [{ pageNumber: f.pageNumber, start: 0, end: 0, raw: '' }],
      detail: { name: f.name },
    }));
}
