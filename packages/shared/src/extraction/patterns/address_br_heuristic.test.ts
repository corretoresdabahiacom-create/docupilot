import { describe, expect, it } from 'vitest';
import { extractAddressHeuristic, PATTERN_ID } from './address_br_heuristic';

const run = (t: string) => extractAddressHeuristic(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['Rua das Flores, 123', 'Rua das Flores, 123'],
    ['Avenida Sete de Setembro, nº 456, Centro', 'Avenida Sete de Setembro, nº 456, Centro'],
    [
      'Av. Paulista, 1000 - Bela Vista, CEP 01310-100',
      'Av. Paulista, 1000 - Bela Vista, CEP 01310-100',
    ],
    ['Travessa do Comércio, 12B', 'Travessa do Comércio, 12B'],
    ['Rodovia BR-324, s/n', 'Rodovia BR-324, s/n'],
    ['Praça da Sé, 1 - 01001-000', 'Praça da Sé, 1 - 01001-000'],
  ])('extrai "%s"', (raw, expected) => {
    const f = run(`Sede na ${raw}\nPróxima linha.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      raw_value: expected,
      confidence: 0.5,
      source_kind: 'heuristic',
      field_type: 'address',
    });
  });

  it.each([
    'Rua das Flores sem número',
    'a rua é longa, 123 pessoas',
    'Avenida, 123',
    'Estradas ruins, 55 km',
    'Ruas, 12',
    'Travessia, 10',
  ])('rejeita "%s"', (t) => {
    expect(run(t)).toHaveLength(0);
  });
});
