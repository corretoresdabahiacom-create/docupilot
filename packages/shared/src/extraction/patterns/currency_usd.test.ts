import { describe, expect, it } from 'vitest';
import { extractCurrencyUSD, PATTERN_ID } from './currency_usd';

const run = (t: string) => extractCurrencyUSD(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['US$ 1,234.56', '1234.56 USD', 1],
    ['US$50', '50.00 USD', 1],
    ['USD 1,000,000.00', '1000000.00 USD', 1],
    ['USD 99.9', '99.90 USD', 1],
    ['$ 250.00 USD', '250.00 USD', 0.9],
    ['$75 (USD)', '75.00 USD', 0.9],
  ])('extrai %s', (raw, norm, conf) => {
    const f = run(`Fee ${raw} due`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ normalized_value: norm, confidence: conf, field_type: 'money' });
  });

  it.each(['$ 250.00', 'R$ 10,00', 'USD', 'US$ abc', 'US$ 1.234,56 x'.replace(' x', '') + '9'])(
    'rejeita %s',
    (raw) => {
      expect(run(`Fee ${raw} due`)).toHaveLength(0);
    },
  );

  it('"$" só vale com USD ou dólar por perto', () => {
    expect(run('Preço $ 10.00 em dólar')).toHaveLength(1);
    expect(run('Preço $ 10.00 na loja')).toHaveLength(0);
  });
});
