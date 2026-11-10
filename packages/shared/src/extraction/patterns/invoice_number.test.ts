import { describe, expect, it } from 'vitest';
import { extractInvoiceNumber, PATTERN_ID } from './invoice_number';

const run = (t: string) => extractInvoiceNumber(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['NF 12345', '12345'],
    ['NF-e 000123456', '000123456'],
    ['NFe nº 4321', '4321'],
    ['Nota Fiscal nº 1.234', '1234'],
    ['Nota Fiscal Eletrônica: 98765', '98765'],
    ['nota fiscal de serviços número 556677', '556677'],
    ['NF: 777', '777'],
  ])('extrai "%s"', (raw, norm) => {
    const f = run(`Ref. ${raw}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: 0.8,
      source_kind: 'heuristic',
    });
  });

  it.each(['NF', 'Nota Fiscal emitida', 'NF 12', 'INFO 12345', 'NF abc123', 'Nota fiscal 12,50'])(
    'rejeita "%s"',
    (raw) => {
      expect(run(`Ref. ${raw} fim`)).toHaveLength(0);
    },
  );
});
