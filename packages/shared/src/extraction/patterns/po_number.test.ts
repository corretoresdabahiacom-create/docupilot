import { describe, expect, it } from 'vitest';
import { extractPONumber, PATTERN_ID } from './po_number';

const run = (t: string) => extractPONumber(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['Pedido nº PC-2024-001', 'PC-2024-001'],
    ['Purchase Order: 4500012345', '4500012345'],
    ['PO #A123', 'A123'],
    ['Pedido de Compra 778899', '778899'],
    ['OC: 2024/0099', '2024/0099'],
    ['Ordem de Compra nº OC-55', 'OC-55'],
  ])('extrai "%s"', (raw, norm) => {
    const f = run(`Ref ${raw}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: 0.7,
      source_kind: 'heuristic',
    });
  });

  it.each(['Pedido anterior', 'PO box', 'Pedido: ab', 'POSSIVEL 1234', 'Pedido 12', 'OCUPADO 999'])(
    'rejeita "%s"',
    (raw) => {
      expect(run(`Ref ${raw}.`)).toHaveLength(0);
    },
  );
});
