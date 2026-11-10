import { describe, expect, it } from 'vitest';
import { extractDateISO, PATTERN_ID } from './date_iso';

const run = (t: string) => extractDateISO(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each(['2026-12-10', '1999-01-01', '2024-02-29', '2100-12-31', '1900-06-15', '2030-07-04'])(
    'extrai %s',
    (d) => {
      const f = run(`Data ${d} fim`);
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({
        normalized_value: d,
        confidence: 1,
        field_type: 'date',
        source_kind: 'deterministic',
      });
    },
  );

  it.each([
    '2023-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '1899-01-01',
    '2101-01-01',
    '20261-01-01',
    '2026-12-100',
  ])('rejeita %s', (d) => {
    expect(run(`Data ${d} fim`)).toHaveLength(0);
  });

  it('captura o rótulo anterior', () => {
    expect(run('Vencimento: 2026-12-10')[0]!.label).toBe('vencimento');
    expect(run('Data de Emissão: 2026-12-10')[0]!.label).toBe('data de emissao');
    expect(run('em 2026-12-10')[0]!.label).toBeUndefined();
  });
});
