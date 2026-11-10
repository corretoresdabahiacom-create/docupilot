import { describe, expect, it } from 'vitest';
import { extractCurrencyEUR, PATTERN_ID } from './currency_eur';

const run = (t: string) => extractCurrencyEUR(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['€ 1.234,56', '1234.56 EUR'],
    ['€1,234.56', '1234.56 EUR'],
    ['EUR 50', '50.00 EUR'],
    ['50 €', '50.00 EUR'],
    ['EUR 1.000.000,00', '1000000.00 EUR'],
    ['12,5 €', '12.50 EUR'],
  ])('extrai %s', (raw, norm) => {
    const f = run(`Price ${raw} total`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ normalized_value: norm, confidence: 1, field_type: 'money' });
  });

  it.each(['€', 'EUR', '€ abc', '1.2.3 €', 'EURO 50', 'US$ 5'])('rejeita %s', (raw) => {
    expect(run(`Price ${raw} total`)).toHaveLength(0);
  });
});
