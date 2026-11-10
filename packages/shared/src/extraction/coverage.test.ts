/**
 * Consistência código ↔ documentação (docs/heuristics.md):
 * 1) todo pattern_id implementado está documentado e tem teste;
 * 2) todo pattern_id documentado está implementado ou na lista de planejados;
 * 3) a lista de planejados nunca contém algo já implementado nem algo fora da doc;
 * 4) todo padrão que extrai campos está em FIELD_PATTERNS (senão o servidor o rejeitaria).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_PATTERNS } from './analyze';

const PATTERNS_DIR = join(import.meta.dirname, 'patterns');
const DOC = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'heuristics.md');

/** Documentados e ainda não implementados. A lista só pode encolher. */
const PLANNED = new Set([
  'acroform_field', // Fase 5
  'acroform_type_mapping', // Fase 5
  'clause_boundary', // Fase 4
  'cnh_number', // Fase 3 (não entregue)
  'contract_party', // Fase 4
  'deadline_expression', // Fase 4
  'diff_clause', // Fase 4
  'diff_fields', // Fase 4
  'diff_textual', // Fase 4
  'keywords_yake', // Fase 3 (não entregue)
  'obligation_marker', // Fase 4
  'passport_br', // Fase 3 (não entregue)
  'rg_flexible', // Fase 3 (não entregue)
  'table_heuristic', // Fase 3 (não entregue)
]);

/** Implementados fora de `patterns/` (código do navegador). */
const IMPLEMENTED_ELSEWHERE: Record<string, string> = {
  ocr_tesseract: 'apps/web/src/lib/extract/ocr.ts',
};

const doc = readFileSync(DOC, 'utf8');
const documented = new Set(
  [...doc.matchAll(/\|\s*`pattern_id`\s*\|\s*`([^`]+)`\s*\|/g)].map((m) => m[1] as string),
);

const files = readdirSync(PATTERNS_DIR).filter(
  (f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts',
);
const implemented = new Map<string, string>();
const missingId: string[] = [];
for (const f of files) {
  const m = readFileSync(join(PATTERNS_DIR, f), 'utf8').match(
    /export\s+const\s+PATTERN_ID\b[^=]*=\s*['"]([^'"]+)['"]/,
  );
  if (m) implemented.set(m[1] as string, basename(f, '.ts'));
  else missingId.push(f);
}

describe('heuristics.md ↔ código', () => {
  it('há padrões documentados e implementados', () => {
    expect(documented.size).toBeGreaterThan(20);
    expect(implemented.size).toBeGreaterThan(20);
  });

  it('todo arquivo em patterns/ exporta PATTERN_ID', () => {
    expect(missingId).toEqual([]);
  });

  it.each([...implemented])('pattern_id "%s" (%s) está documentado', (id) => {
    expect(documented.has(id), `"${id}" não está em docs/heuristics.md`).toBe(true);
  });

  it.each([...implemented])('pattern_id "%s" tem arquivo de teste (%s.test.ts)', (_id, file) => {
    expect(existsSync(join(PATTERNS_DIR, `${file}.test.ts`))).toBe(true);
  });

  it('o nome do arquivo é o pattern_id (exceto utilitários documentados)', () => {
    for (const [id, file] of implemented) {
      if (id === 'cpf_strict' || file === id) continue;
      expect.soft(file, `arquivo ${file} exporta ${id}`).toBe(id);
    }
  });

  it.each([...documented])('"%s" está implementado, em outro local ou planejado', (id) => {
    const ok = implemented.has(id) || id in IMPLEMENTED_ELSEWHERE || PLANNED.has(id);
    expect(ok, `"${id}" documentado sem implementação nem plano`).toBe(true);
  });

  it('a lista de planejados não contém implementados nem itens fora da doc', () => {
    expect([...PLANNED].filter((id) => implemented.has(id) || id in IMPLEMENTED_ELSEWHERE)).toEqual(
      [],
    );
    expect([...PLANNED].filter((id) => !documented.has(id))).toEqual([]);
  });

  it('implementações fora de patterns/ existem de fato', () => {
    for (const rel of Object.values(IMPLEMENTED_ELSEWHERE)) {
      expect(existsSync(join(import.meta.dirname, '..', '..', '..', '..', rel)), rel).toBe(true);
    }
  });

  it('todo padrão que extrai campos está em FIELD_PATTERNS', () => {
    const nonField = new Set([
      'dedup_exact',
      'dedup_failed',
      'dedup_simhash',
      'language_detect',
      'summary_textrank',
      'text_garbage_detector',
    ]);
    for (const id of implemented.keys()) {
      if (!nonField.has(id))
        expect(FIELD_PATTERNS[id], `${id} fora de FIELD_PATTERNS`).toBeDefined();
    }
    for (const id of Object.keys(FIELD_PATTERNS)) expect(implemented.has(id), id).toBe(true);
  });

  it('o limiar do SimHash declarado na doc é o do código', async () => {
    const { SIMILAR_MAX_DISTANCE } = await import('./patterns/dedup_simhash');
    expect(doc).toMatch(new RegExp(`distância de Hamming ≤ ${SIMILAR_MAX_DISTANCE}`));
  });
});
