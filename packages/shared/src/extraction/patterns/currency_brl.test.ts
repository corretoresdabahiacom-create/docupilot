import { describe, expect, it } from 'vitest';
import { extractCurrencyBRL, PATTERN_ID } from './currency_brl';

const run = (t: string) => extractCurrencyBRL(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['R$ 1.234,56', '1234.56 BRL'],
    ['R$1.234,56', '1234.56 BRL'],
    ['R$ 50,00', '50.00 BRL'],
    ['R$ 1.000.000,00', '1000000.00 BRL'],
    ['R$ 1500', '1500.00 BRL'],
    ['R$ 1500,00', '1500.00 BRL'],
    ['R$ 0,99', '0.99 BRL'],
  ])('extrai %s', (raw, norm) => {
    const f = run(`Total: ${raw}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      raw_value: raw,
      normalized_value: norm,
      confidence: 1,
      field_type: 'money',
      label: 'total',
    });
  });

  it.each(['1.234,56', 'R$', 'R$ abc', 'US$ 10,00', 'R$ 1.23,45', 'R$ 12.34', 'BR$ 5,00'])(
    'rejeita %s',
    (raw) => {
      expect(run(`valor ${raw} fim`).map((f) => f.raw_value)).not.toContain(raw);
      expect(run(`valor ${raw} fim`)).toHaveLength(0);
    },
  );

  it('offsets conferem', () => {
    const text = 'Pague R$ 1.234,56 hoje';
    const [f] = run(text);
    expect(text.slice(f!.text_span_start, f!.text_span_end)).toBe('R$ 1.234,56');
  });
});
