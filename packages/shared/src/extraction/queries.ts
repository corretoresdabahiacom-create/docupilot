/** Consultas predefinidas sobre campos já extraídos (cada resposta cita página e trecho). */
export const PREDEFINED_QUERIES = ['total_value', 'due_dates', 'cpf_cnpj', 'dates'] as const;
export type PredefinedQuery = (typeof PREDEFINED_QUERIES)[number];

export interface QueryableField {
  fieldType: string;
  normalizedValue: string;
  label: string | null;
}

const DUE_LABEL = /venc|prazo|validade|pagamento ate|pagar ate/;
const TOTAL_LABEL = /total|valor global|valor do contrato|valor da nota/;

/** Seleciona os campos que respondem à consulta; vazio = "não encontrado no que foi extraído". */
export function selectForQuery<T extends QueryableField>(q: PredefinedQuery, fields: T[]): T[] {
  switch (q) {
    case 'total_value':
      return fields.filter(
        (f) => f.fieldType === 'money' && f.label !== null && TOTAL_LABEL.test(f.label),
      );
    case 'due_dates':
      return fields.filter(
        (f) => f.fieldType === 'date' && f.label !== null && DUE_LABEL.test(f.label),
      );
    case 'cpf_cnpj':
      return fields.filter((f) => f.fieldType === 'cpf' || f.fieldType === 'cnpj');
    case 'dates':
      return fields.filter((f) => f.fieldType === 'date');
  }
}
