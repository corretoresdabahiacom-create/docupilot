import { describe, expect, it } from 'vitest';
import { cnjCheckDigits, extractProcessNumber, PATTERN_ID } from './process_number_br';

const run = (t: string) => extractProcessNumber(t, 'd1', 1);

// DVs calculados de forma independente: 98 − ((N AAAA JTR OOOO 00) mod 97), com BigInt.
const dv = (n: string, y: string, j: string, tr: string, o: string) =>
  String(98n - (BigInt(`${n}${y}${j}${tr}${o}00`) % 97n)).padStart(2, '0');

describe(PATTERN_ID, () => {
  it.each([
    ['0000001-78.2020.8.26.0100'],
    ['1234567-13.2019.5.02.0001'],
    ['0012345-74.2021.4.03.6100'],
  ])('extrai %s', (raw) => {
    const f = run(`Processo nº ${raw}, em curso`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: raw,
      confidence: 1,
      source_kind: 'deterministic',
      field_type: 'process_number',
    });
  });

  it('cnjCheckDigits confere com o cálculo independente', () => {
    for (const [n, y, j, tr, o] of [
      ['0000001', '2020', '8', '26', '0100'],
      ['7654321', '2018', '1', '01', '0042'],
      ['0000000', '2000', '9', '99', '9999'],
    ] as const) {
      expect(cnjCheckDigits(n, y, j, tr, o)).toBe(dv(n, y, j, tr, o));
    }
  });

  it.each([
    '0000001-79.2020.8.26.0100', // DV errado
    '0000001-78.2020.8.26.010', // curto
    '00000017820208260100', // sem pontuação
    '0000001-78.2020.8.26.01000', // longo
    '0000001-78/2020.8.26.0100',
  ])('rejeita %s', (raw) => {
    expect(run(`Proc. ${raw}`)).toHaveLength(0);
  });
});
