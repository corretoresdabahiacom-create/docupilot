import { describe, expect, it } from 'vitest';
import { extractCEP, PATTERN_ID } from './cep_strict';

const run = (t: string) => extractCEP(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['CEP 01310-100', '01310100', 1.0, 'deterministic'],
    ['CEP: 40020000', '40020000', 1.0, 'deterministic'],
    ['cep 40.020-000'.replace('.', ''), '40020000', 1.0, 'deterministic'],
    ['CEP nº 70040-010', '70040010', 1.0, 'deterministic'],
    ['Salvador, 40020-000', '40020000', 0.5, 'heuristic'],
    ['CEP:99999-999', '99999999', 1.0, 'deterministic'],
  ])('extrai em "%s"', (text, norm, conf, kind) => {
    const f = run(text);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: conf,
      source_kind: kind,
      field_type: 'cep',
    });
  });

  it.each([
    'número 40020000 do pedido', // 8 dígitos soltos, sem CEP nem hífen
    'CEP 00999-999', // fora da faixa
    'CEP 1234-567',
    'CEP 123456-789',
    'CEP 401230000',
    'processo 0001234-55', // outro formato
  ])('rejeita "%s"', (t) => {
    expect(run(t)).toHaveLength(0);
  });

  it('offsets conferem', () => {
    const text = 'Rua A, CEP 01310-100.';
    const [f] = run(text);
    expect(text.slice(f!.text_span_start, f!.text_span_end)).toBe('01310-100');
  });
});
