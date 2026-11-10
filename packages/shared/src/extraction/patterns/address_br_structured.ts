/**
 * Pattern address_br_structured — docs/heuristics.md §2.6. Extração por rótulos explícitos
 * (Logradouro/Endereço, Bairro, Cidade, Estado/UF, CEP) em linhas seguidas.
 */
import type { ExtractedField } from '../types';
import { field, stripAccents } from '../util';

export const PATTERN_ID = 'address_br_structured' as const;
export const FIELD_TYPE = 'address' as const;

const LABEL_LINE =
  /^[ \t]*(Logradouro|Endere[çc]o|Bairro|Cidade|Munic[ií]pio|Estado|UF|CEP)[ \t]*:[ \t]*(.+?)[ \t]*$/gimu;

export function extractAddressStructured(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  type Hit = { key: string; value: string; start: number; end: number };
  const hits: Hit[] = [];
  for (const m of text.matchAll(LABEL_LINE)) {
    const key = stripAccents((m[1] as string).toLowerCase());
    const start = m.index ?? 0;
    hits.push({
      key,
      value: (m[2] as string).trim(),
      start,
      end: start + m[0].replace(/[ \t]+$/, '').length,
    });
  }
  // agrupa linhas rotuladas consecutivas, iniciando em Logradouro/Endereço
  let i = 0;
  while (i < hits.length) {
    const first = hits[i] as Hit;
    if (first.key !== 'logradouro' && first.key !== 'endereco') {
      i++;
      continue;
    }
    const group: Hit[] = [first];
    let j = i + 1;
    while (j < hits.length) {
      const h = hits[j] as Hit;
      const prev = group[group.length - 1] as Hit;
      if (h.start - prev.end > 3) break; // linhas rotuladas vizinhas
      if (group.some((g) => g.key === h.key)) break;
      if (h.key === 'logradouro' || h.key === 'endereco') break;
      group.push(h);
      j++;
    }
    i = j;
    const has = (k: string) => group.find((g) => g.key === k)?.value;
    const city = has('cidade') ?? has('municipio');
    const cep = has('cep');
    if (!city && !cep) continue; // só logradouro: pouco para chamar de endereço estruturado
    const parts = [first.value, has('bairro'), city, has('estado') ?? has('uf'), cep].filter(
      Boolean,
    ) as string[];
    const start = first.start;
    const end = (group[group.length - 1] as Hit).end;
    const raw = text.slice(start, end);
    if (raw.length > 400) continue;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end,
        raw,
        normalized: parts.join(', '),
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 0.9,
        sourceKind: 'deterministic',
      }),
    );
  }
  return out;
}
