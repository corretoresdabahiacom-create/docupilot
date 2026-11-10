import { describe, expect, it } from 'vitest';
import { extractCurrencyWrittenBR, parseWrittenNumber, PATTERN_ID } from './currency_written_br';

const run = (t: string) => extractCurrencyWrittenBR(t, 'd1', 1);

describe('parseWrittenNumber', () => {
  it.each([
    ['um', 1],
    ['dois', 2],
    ['dez', 10],
    ['onze', 11],
    ['dezenove', 19],
    ['vinte', 20],
    ['vinte e um', 21],
    ['trinta e cinco', 35],
    ['noventa e nove', 99],
    ['cem', 100],
    ['cento e um', 101],
    ['cento e dez', 110],
    ['cento e vinte e três', 123],
    ['duzentos', 200],
    ['novecentos e noventa e nove', 999],
    ['mil', 1000],
    ['um mil', 1000],
    ['dois mil', 2000],
    ['um mil duzentos e trinta e quatro', 1234],
    ['dez mil e um', 10001],
    ['cem mil', 100000],
    ['um milhão', 1_000_000],
    ['dois milhões e quinhentos mil', 2_500_000],
    ['um bilhão', 1_000_000_000],
    ['zero', 0],
  ])('%s = %i', (words, n) => {
    expect(parseWrittenNumber(words)).toBe(n);
  });

  it.each([
    'mil mil',
    'cem e dois',
    'vinte vinte',
    'dez e um',
    'milhão',
    'um mil milhão',
    'zero um',
    'trinta e dez',
    'duzentos e cem',
    'banana',
  ])('rejeita "%s"', (words) => {
    expect(parseWrittenNumber(words)).toBeNull();
  });
});

describe(PATTERN_ID, () => {
  it.each([
    ['um mil duzentos e trinta e quatro reais', '1234.00 BRL'],
    ['cem reais', '100.00 BRL'],
    ['um real', '1.00 BRL'],
    ['dois mil reais e cinquenta centavos', '2000.50 BRL'],
    ['cinco reais e um centavo', '5.01 BRL'],
    ['dois milhões e quinhentos mil reais', '2500000.00 BRL'],
    ['Quinhentos Reais', '500.00 BRL'],
  ])('extrai "%s"', (raw, norm) => {
    const f = run(`valor de ${raw}, a pagar`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: 0.8,
      source_kind: 'heuristic',
      field_type: 'money',
    });
  });

  it.each([
    'mil mil reais',
    'banana reais',
    'reais',
    'vinte reais e cem centavos',
    'cem e dois reais',
  ])('rejeita "%s"', (raw) => {
    expect(run(`valor de ${raw}.`)).toHaveLength(0);
  });
});
