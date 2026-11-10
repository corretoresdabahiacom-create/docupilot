import { describe, expect, it } from 'vitest';
import {
  hammingDistance,
  isPossiblySimilar,
  MIN_WORDS,
  PATTERN_ID,
  SIMILAR_MAX_DISTANCE,
  simhash64,
} from './dedup_simhash';

const WORDS =
  'contrato prestacao servicos partes pagamento prazo multa rescisao foro comarca vigencia reajuste indice obrigacoes direitos deveres garantia sigilo propriedade intelectual'.split(
    ' ',
  );
function doc(seed: number, n = 400): string {
  let s = seed;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(WORDS[s % WORDS.length] as string);
  }
  return out.join(' ');
}

describe('hammingDistance', () => {
  it.each([
    ['0000000000000000', '0000000000000000', 0],
    ['0000000000000000', 'ffffffffffffffff', 64],
    ['0000000000000001', '0000000000000000', 1],
    ['f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f', 64],
    ['aaaaaaaaaaaaaaaa', '5555555555555555', 64],
    ['00000000000000ff', '0000000000000000', 8],
    ['8000000000000000', '0000000000000001', 2],
  ])('%s vs %s = %i', (a, b, d) => {
    expect(hammingDistance(a, b)).toBe(d);
    expect(hammingDistance(b, a)).toBe(d);
  });

  it.each([
    ['xyz', '0000000000000000'],
    ['0000', '0000000000000000'],
    ['GGGGGGGGGGGGGGGG', '0000000000000000'],
  ])('rejeita entrada inválida %s', (a, b) => {
    expect(() => hammingDistance(a, b)).toThrow();
  });
});

describe(PATTERN_ID, () => {
  it('texto idêntico → distância 0', () => {
    const t = doc(1);
    expect(hammingDistance(simhash64(t)!, simhash64(t)!)).toBe(0);
  });

  it('ignora caixa, acento e pontuação', () => {
    expect(simhash64('Ação, AÇÃO! ' + doc(1))).toBe(simhash64('acao acao ' + doc(1).toUpperCase()));
  });

  it('pequena edição fica dentro do limiar', () => {
    const a = doc(2, 600);
    const words = a.split(' ');
    words[300] = 'xyzzy';
    words[301] = 'plugh';
    const d = hammingDistance(simhash64(a)!, simhash64(words.join(' '))!);
    expect(d).toBeLessThanOrEqual(SIMILAR_MAX_DISTANCE);
    expect(isPossiblySimilar(simhash64(a)!, simhash64(words.join(' '))!)).toBe(true);
  });

  it('textos distintos ficam acima do limiar', () => {
    const mk = (seed: string) =>
      Array.from({ length: 300 }, (_, i) => `${seed}${(i * 7919) % 613}`).join(' ');
    const d = hammingDistance(simhash64(mk('alfa'))!, simhash64(mk('beta'))!);
    expect(d).toBeGreaterThan(SIMILAR_MAX_DISTANCE);
  });

  it('texto curto não gera hash', () => {
    expect(simhash64('poucas palavras aqui')).toBeNull();
    expect(
      simhash64(
        Array(MIN_WORDS - 1)
          .fill('a')
          .join(' '),
      ),
    ).toBeNull();
    expect(
      simhash64(
        Array(MIN_WORDS + 3)
          .fill('a')
          .join(' '),
      ),
    ).toMatch(/^[0-9a-f]{16}$/);
  });

  it('limiar declarado é 6', () => {
    expect(SIMILAR_MAX_DISTANCE).toBe(6);
  });
});
