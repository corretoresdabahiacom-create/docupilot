import { describe, expect, it } from 'vitest';
import { isExactDuplicate, PATTERN_ID } from './dedup_exact';

const h = (c: string) => c.repeat(64);

describe(PATTERN_ID, () => {
  it.each(['a', '0', 'f', '1', 'e'])('hashes iguais (%s) são duplicado exato', (c) => {
    expect(isExactDuplicate(h(c), h(c))).toBe(true);
  });
  it.each([
    [h('a'), h('b')],
    ['abc', 'abc'],
    ['', ''],
    [h('A'), h('A')],
    [h('a'), `${h('a')}0`],
  ])('rejeita %s vs %s', (a, b) => {
    expect(isExactDuplicate(a, b)).toBe(false);
  });
});
