import { describe, expect, it } from 'vitest';
import { extractPercentage, PATTERN_ID } from './money_percentage';

const run = (t: string) => extractPercentage(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['10%', '10'],
    ['12,5 %', '12.5'],
    ['100%', '100'],
    ['0,75%', '0.75'],
    ['2 %', '2'],
    ['33,33%', '33.33'],
  ])('extrai %s', (raw, norm) => {
    const f = run(`multa de ${raw} ao mês`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: 0.9,
      field_type: 'percentage',
    });
  });

  it.each(['%', 'abc%', '1.000%', '1234%', '10,123%'])('rejeita %s', (raw) => {
    expect(run(`x ${raw} y`)).toHaveLength(0);
  });
});
