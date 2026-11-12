/**
 * Pattern diff_fields — docs/heuristics.md §13.2.
 * Compara os campos que os padrões da Fase 3 encontram nos dois textos. Cada linha mostra o
 * valor de A e o de B com página e trecho de origem dos dois lados. Os campos são recalculados
 * no navegador a partir do texto armazenado; não são gravados nem reconferidos pelo servidor.
 */
import { detectLanguage } from './language_detect';
import { extractAll, type PageText } from '../analyze';
import { contextAround, type Context } from '../compare_util';
import type { ExtractedField, SourceKind } from '../types';

export const PATTERN_ID = 'diff_fields' as const;

export type FieldDiffStatus = 'igual' | 'alterado' | 'somente_a' | 'somente_b';

export interface FieldSide {
  normalized: string;
  raw: string;
  patternId: string;
  sourceKind: SourceKind;
  confidence: number;
  /** Total de ocorrências do valor neste lado. */
  occurrences: number;
  /** Até MAX_SOURCES origens. */
  sources: Array<{ pageNumber: number; context: Context }>;
}

export interface ComparedField {
  fieldType: string;
  label: string | null;
  status: FieldDiffStatus;
  a: FieldSide | null;
  b: FieldSide | null;
}

export const MAX_SOURCES = 3;
/** Ocorrências lidas por lado (mesmo teto do servidor na análise). */
const MAX_OCCURRENCES = 400;

interface Collected {
  field: ExtractedField;
  context: Context;
}

function collect(pages: PageText[], tag: string): Collected[] {
  const sorted = [...pages].sort((x, y) => x.pageNumber - y.pageNumber);
  const lang = detectLanguage(sorted.map((p) => p.text).join('\n')).language;
  const out: Collected[] = [];
  for (const p of sorted) {
    for (const f of extractAll(p.text, tag, p.pageNumber, { language: lang })) {
      out.push({ field: f, context: contextAround(p.text, f.text_span_start, f.text_span_end) });
    }
  }
  return out.slice(0, MAX_OCCURRENCES);
}

function side(items: Collected[]): FieldSide {
  const first = items[0] as Collected;
  return {
    normalized: first.field.normalized_value,
    raw: first.field.raw_value,
    patternId: first.field.pattern_id,
    sourceKind: first.field.source_kind,
    confidence: first.field.confidence,
    occurrences: items.length,
    sources: items
      .slice(0, MAX_SOURCES)
      .map((i) => ({ pageNumber: i.field.page_number, context: i.context })),
  };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function diffFields(pagesA: PageText[], pagesB: PageText[]): ComparedField[] {
  const a = collect(pagesA, 'a');
  const b = collect(pagesB, 'b');
  const groupKey = (c: Collected) => `${c.field.field_type}\u0000${c.field.label ?? ''}`;
  const ga = groupBy(a, groupKey);
  const gb = groupBy(b, groupKey);
  const keys = [...new Set([...ga.keys(), ...gb.keys()])].sort();

  const rows: ComparedField[] = [];
  for (const key of keys) {
    const [fieldType = '', labelRaw = ''] = key.split('\u0000');
    const label = labelRaw === '' ? null : labelRaw;
    const va = groupBy(ga.get(key) ?? [], (c) => c.field.normalized_value);
    const vb = groupBy(gb.get(key) ?? [], (c) => c.field.normalized_value);
    const common = [...va.keys()].filter((v) => vb.has(v)).sort();
    const onlyA = [...va.keys()].filter((v) => !vb.has(v)).sort();
    const onlyB = [...vb.keys()].filter((v) => !va.has(v)).sort();

    for (const v of common) {
      rows.push({
        fieldType,
        label,
        status: 'igual',
        a: side(va.get(v) as Collected[]),
        b: side(vb.get(v) as Collected[]),
      });
    }
    // "alterado" só quando há rótulo: sem rótulo não dá para afirmar que os dois valores
    // são o mesmo campo.
    if (label !== null && onlyA.length === 1 && onlyB.length === 1) {
      rows.push({
        fieldType,
        label,
        status: 'alterado',
        a: side(va.get(onlyA[0] as string) as Collected[]),
        b: side(vb.get(onlyB[0] as string) as Collected[]),
      });
    } else {
      for (const v of onlyA)
        rows.push({
          fieldType,
          label,
          status: 'somente_a',
          a: side(va.get(v) as Collected[]),
          b: null,
        });
      for (const v of onlyB)
        rows.push({
          fieldType,
          label,
          status: 'somente_b',
          a: null,
          b: side(vb.get(v) as Collected[]),
        });
    }
  }
  return rows;
}
