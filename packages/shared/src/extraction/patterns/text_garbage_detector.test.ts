import { describe, expect, it } from 'vitest';
import { detectTextGarbage, PATTERN_ID } from './text_garbage_detector';

describe(PATTERN_ID, () => {
  it('texto normal não dispara', () => {
    expect(
      detectTextGarbage('Este é um parágrafo comum de um contrato de prestação de serviços.')
        .garbage,
    ).toBe(false);
  });
  it.each(['�'.repeat(60), ''.repeat(60), '', '   ', '...---...---...---...---'])(
    'dispara em texto corrompido/vazio %#',
    (t) => {
      expect(detectTextGarbage(t).garbage).toBe(true);
    },
  );
});
