/** Regras leves sobre campos já extraídos (a Fase 3 guarda os campos; o workflow só lê). */

export interface FieldLike {
  fieldType: string;
  normalizedValue: string;
  label?: string | null;
}

export type FieldCompareStatus = 'igual' | 'alterado' | 'somente_a' | 'somente_b';
export interface FieldCompareItem {
  type: string;
  label: string | null;
  status: FieldCompareStatus;
  a: string[];
  b: string[];
}
export interface FieldCompareResult {
  equal: number;
  changed: number;
  onlyA: number;
  onlyB: number;
  items: FieldCompareItem[];
}

export const MAX_COMPARE_ITEMS = 50;

/**
 * Compara os campos extraídos de dois documentos. "Alterado" só vale quando os dois lados têm o
 * mesmo tipo E o mesmo rótulo e valores diferentes; sem rótulo, cada valor é comparado sozinho.
 * Compara o que a análise guardou, não o texto: é consultivo e não substitui a tela de comparação.
 */
export function compareFieldSets(
  a: readonly FieldLike[],
  b: readonly FieldLike[],
): FieldCompareResult {
  const group = (list: readonly FieldLike[]) => {
    const m = new Map<string, { type: string; label: string | null; values: Set<string> }>();
    for (const f of list) {
      const label = f.label?.trim() ? f.label.trim().toLowerCase() : null;
      const key = `${f.fieldType}|${label ?? ''}`;
      const g = m.get(key) ?? { type: f.fieldType, label, values: new Set<string>() };
      g.values.add(f.normalizedValue);
      m.set(key, g);
    }
    return m;
  };
  const ga = group(a);
  const gb = group(b);
  const items: FieldCompareItem[] = [];
  const keys = [...new Set([...ga.keys(), ...gb.keys()])].sort();
  for (const key of keys) {
    const x = ga.get(key);
    const y = gb.get(key);
    const type = (x ?? y)!.type;
    const label = (x ?? y)!.label;
    const va = [...(x?.values ?? [])].sort();
    const vb = [...(y?.values ?? [])].sort();
    if (!x) items.push({ type, label, status: 'somente_b', a: [], b: vb });
    else if (!y) items.push({ type, label, status: 'somente_a', a: va, b: [] });
    else if (va.join('\n') === vb.join('\n'))
      items.push({ type, label, status: 'igual', a: va, b: vb });
    else if (label) items.push({ type, label, status: 'alterado', a: va, b: vb });
    else {
      // Sem rótulo: valores em comum são "igual"; os demais ficam de um lado só.
      const both = va.filter((v) => vb.includes(v));
      if (both.length) items.push({ type, label, status: 'igual', a: both, b: both });
      const onlyA = va.filter((v) => !vb.includes(v));
      const onlyB = vb.filter((v) => !va.includes(v));
      if (onlyA.length) items.push({ type, label, status: 'somente_a', a: onlyA, b: [] });
      if (onlyB.length) items.push({ type, label, status: 'somente_b', a: [], b: onlyB });
    }
  }
  const count = (s: FieldCompareStatus) => items.filter((i) => i.status === s).length;
  return {
    equal: count('igual'),
    changed: count('alterado'),
    onlyA: count('somente_a'),
    onlyB: count('somente_b'),
    items: items.slice(0, MAX_COMPARE_ITEMS),
  };
}

/** Tipos exigidos que não aparecem em nenhum campo. */
export function missingTypes(fields: readonly FieldLike[], required: readonly string[]): string[] {
  const have = new Set(fields.map((f) => f.fieldType));
  return required.filter((t) => !have.has(t));
}

/**
 * Valor para um `{{campo}}` de modelo: o campo extraído do tipo (e rótulo, se pedido). Só devolve
 * quando há UM valor distinto; com zero ou vários não escolhe (fica em branco e é avisado).
 */
export function pickFieldValue(
  fields: readonly FieldLike[],
  map: { fieldType: string; label?: string | undefined },
): { value: string } | { value: null; reason: 'missing' | 'ambiguous' } {
  const want = map.label?.trim().toLowerCase();
  const values = [
    ...new Set(
      fields
        .filter(
          (f) => f.fieldType === map.fieldType && (!want || f.label?.trim().toLowerCase() === want),
        )
        .map((f) => f.normalizedValue),
    ),
  ];
  if (values.length === 1) return { value: values[0] as string };
  return { value: null, reason: values.length === 0 ? 'missing' : 'ambiguous' };
}
