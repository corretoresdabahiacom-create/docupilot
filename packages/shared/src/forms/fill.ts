/**
 * Preenchimento ASSISTIDO de formulário (Fase 5). Função pura, roda no navegador.
 *
 * Regras que o código garante (e os testes verificam):
 *  - nenhum valor nasce sem origem: vem de um perfil do usuário, de um documento de referência
 *    ou do que a própria pessoa digitou; sem origem o campo fica `campo_ausente`;
 *  - ambiguidade nunca é resolvida em silêncio: mais de um valor possível → `aguardando_confirmacao`;
 *  - só o que está `confirmado` vai para o PDF.
 */
import type { FormField, UnsupportedReason } from '../extraction/patterns/acroform_field';
import {
  canonicalize,
  formatForField,
  mapFieldName,
  validateValue,
  type CanonKey,
  type ValueError,
} from '../extraction/patterns/acroform_type_mapping';
import { stripAccents } from '../extraction/util';

export const FILL_STATES = [
  'mapeado_automaticamente',
  'preenchido_por_regex',
  'aguardando_confirmacao',
  'campo_ausente',
  'campo_invalido',
  'confirmado',
] as const;
export type FillState = (typeof FILL_STATES)[number];

export type FillReason =
  'unsupported' | 'unmapped' | 'other_person' | 'no_source' | 'name_heuristic' | 'ambiguous';

export interface Origin {
  kind: 'profile' | 'document' | 'manual';
  label: string;
  documentId?: string;
  pageNumber?: number;
}

/** Um dado conhecido, em forma canônica, com de onde veio. */
export interface DataSource {
  key: CanonKey;
  value: string;
  origin: Origin;
}

export interface ValueCandidate {
  value: string;
  origins: Origin[];
}

export interface FillItem {
  field: FormField;
  key: CanonKey | null;
  /** Como o nome do campo foi ligado ao dado: tabela de equivalência ou regex de nome. */
  via: 'table' | 'regex' | null;
  state: FillState;
  reason: FillReason | null;
  /** Já formatado para o campo (texto ou caixa marcada); null se não há valor. */
  value: string | boolean | null;
  candidates: ValueCandidate[];
  origins: Origin[];
  error: ValueError | null;
  /** false para assinatura, botão, somente leitura: não entram na contagem nem no PDF. */
  fillable: boolean;
  unsupportedReason: UnsupportedReason | null;
}

const dedupKey = (v: string) => stripAccents(v).toLowerCase().replace(/\s+/g, ' ').trim();

function candidatesFor(key: CanonKey, sources: DataSource[]): ValueCandidate[] {
  const map = new Map<string, ValueCandidate>();
  for (const s of sources) {
    if (s.key !== key) continue;
    const k = dedupKey(s.value);
    const cur = map.get(k);
    if (cur) cur.origins.push(s.origin);
    else map.set(k, { value: s.value, origins: [s.origin] });
  }
  return [...map.values()];
}

const base = (field: FormField): FillItem => ({
  field,
  key: null,
  via: null,
  state: 'campo_ausente',
  reason: null,
  value: null,
  candidates: [],
  origins: [],
  error: null,
  fillable: field.kind !== 'unsupported',
  unsupportedReason: field.unsupportedReason,
});

export function proposeFill(
  fields: FormField[],
  sources: DataSource[],
  now: Date = new Date(),
): FillItem[] {
  return fields.map((field) => {
    const item = base(field);
    if (field.kind === 'unsupported') return { ...item, reason: 'unsupported' as const };
    const match = mapFieldName(field);
    if (match.kind === 'none') return { ...item, reason: 'unmapped' as const };
    if (match.kind === 'other_person') return { ...item, reason: 'other_person' as const };

    const withKey: FillItem = { ...item, key: match.key, via: match.via };
    const candidates = candidatesFor(match.key, sources);
    if (candidates.length === 0) return { ...withKey, reason: 'no_source' as const };

    const fmt = (c: ValueCandidate) => formatForField(match.key, c.value, field.maxLength);
    // Nome só "parece" o dado: sugere, mas quem decide é a pessoa.
    if (match.via === 'regex') {
      const only = candidates.length === 1 ? (candidates[0] as ValueCandidate) : null;
      return {
        ...withKey,
        state: 'aguardando_confirmacao' as const,
        reason: 'name_heuristic' as const,
        candidates,
        value: only ? fmt(only) : null,
        origins: only ? only.origins : [],
      };
    }
    if (candidates.length > 1)
      return {
        ...withKey,
        state: 'aguardando_confirmacao' as const,
        reason: 'ambiguous' as const,
        candidates,
      };

    const only = candidates[0] as ValueCandidate;
    const text = fmt(only);
    const check = validateValue(field, match.key, text, now);
    if (!check.ok)
      return {
        ...withKey,
        state: 'campo_invalido' as const,
        value: text,
        candidates,
        origins: only.origins,
        error: check.error,
      };
    return {
      ...withKey,
      state: only.origins.some((o) => o.kind === 'profile')
        ? ('mapeado_automaticamente' as const)
        : ('preenchido_por_regex' as const),
      value: check.value,
      candidates,
      origins: only.origins,
    };
  });
}

function settle(
  item: FillItem,
  value: string | boolean | null,
  origins: Origin[],
  now: Date,
): FillItem {
  if (!item.fillable) return item;
  if (value === null || (typeof value === 'string' && value.trim() === ''))
    return { ...item, state: 'campo_ausente', value: null, origins: [], error: null };
  const check = validateValue(item.field, item.key, value, now);
  if (!check.ok) return { ...item, state: 'campo_invalido', value, origins, error: check.error };
  return { ...item, state: 'confirmado', value: check.value, origins, error: null };
}

/** A pessoa confirma o valor que está na linha. Sem valor, não há o que confirmar. */
export function confirmItem(item: FillItem, now: Date = new Date()): FillItem {
  return settle(item, item.value, item.origins, now);
}

/** A pessoa digitou (ou marcou) um valor: a origem passa a ser "manual". */
export function setManual(
  item: FillItem,
  value: string | boolean,
  now: Date = new Date(),
): FillItem {
  return settle(item, value, [{ kind: 'manual', label: 'manual' }], now);
}

/** A pessoa escolheu um dos valores candidatos (caso ambíguo). */
export function pickCandidate(item: FillItem, index: number, now: Date = new Date()): FillItem {
  const cand = item.candidates[index];
  if (!cand || item.key === null) return item;
  const text = formatForField(item.key, cand.value, item.field.maxLength);
  return settle(item, text, cand.origins, now);
}

export function clearItem(item: FillItem): FillItem {
  if (!item.fillable) return item;
  return { ...item, state: 'campo_ausente', value: null, origins: [], error: null };
}

/** Ação explícita da pessoa: confirma de uma vez o que foi preenchido automaticamente. */
export function confirmSuggested(items: FillItem[], now: Date = new Date()): FillItem[] {
  return items.map((i) =>
    i.state === 'mapeado_automaticamente' || i.state === 'preenchido_por_regex'
      ? confirmItem(i, now)
      : i,
  );
}

/** O que vai para o PDF: somente campos confirmados. */
export function toWrite(items: FillItem[]): Array<{ name: string; value: string | boolean }> {
  const out: Array<{ name: string; value: string | boolean }> = [];
  for (const i of items)
    if (i.fillable && i.state === 'confirmado' && i.value !== null)
      out.push({ name: i.field.name, value: i.value });
  return out;
}

export interface FillSummary {
  total: number;
  counts: Record<FillState, number>;
  confirmed: number;
  /** Campos obrigatórios que ficarão sem valor no PDF. */
  requiredMissing: string[];
  /** Campos que ficarão em branco (todos os fillable não confirmados). */
  blank: number;
  unsupported: number;
}

export function summarizeFill(items: FillItem[]): FillSummary {
  const counts = Object.fromEntries(FILL_STATES.map((s) => [s, 0])) as Record<FillState, number>;
  const requiredMissing: string[] = [];
  let total = 0;
  let unsupported = 0;
  for (const i of items) {
    if (!i.fillable) {
      unsupported++;
      continue;
    }
    total++;
    counts[i.state]++;
    if (i.field.required && i.state !== 'confirmado' && !i.field.filled)
      requiredMissing.push(i.field.name);
  }
  return {
    total,
    counts,
    confirmed: counts.confirmado,
    requiredMissing,
    blank: total - counts.confirmado,
    unsupported,
  };
}

// ---------- fontes de dados ----------

/** Campo extraído de um documento de referência (formato da API de análise). */
export interface ExtractedLike {
  fieldType: string;
  normalizedValue: string;
  label: string | null;
  sources: Array<{ pageNumber: number }>;
}

function keyForExtracted(f: ExtractedLike): CanonKey | null {
  switch (f.fieldType) {
    case 'cpf':
    case 'cnpj':
    case 'email':
    case 'cep':
    case 'address':
      return f.fieldType;
    case 'phone':
    case 'phone_landline':
      return 'phone';
    case 'date':
      // Uma data só é "nascimento" se o próprio texto a rotula assim.
      return f.label && /nasc/.test(stripAccents(f.label).toLowerCase()) ? 'birth_date' : null;
    default:
      return null;
  }
}

/** Dados que os padrões (regex) da Fase 3 encontraram num documento de referência. */
export function sourcesFromExtracted(
  fields: ExtractedLike[],
  doc: { id: string; name: string },
  now: Date = new Date(),
): DataSource[] {
  const out: DataSource[] = [];
  for (const f of fields) {
    const key = keyForExtracted(f);
    if (!key) continue;
    const value = canonicalize(key, f.normalizedValue, now);
    if (value === null) continue;
    out.push({
      key,
      value,
      origin: {
        kind: 'document',
        label: doc.name,
        documentId: doc.id,
        pageNumber: f.sources[0]?.pageNumber,
      },
    });
  }
  return out;
}

/** Dados do perfil de dados pessoais do usuário (já canônicos). */
export function sourcesFromProfile(
  fields: Partial<Record<CanonKey, string>>,
  label: string,
): DataSource[] {
  const out: DataSource[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value !== '')
      out.push({ key: key as CanonKey, value, origin: { kind: 'profile', label } });
  }
  return out;
}
