import { describe, expect, it } from 'vitest';
import { canCompareSimilarity, PATTERN_ID } from './dedup_failed';

describe(PATTERN_ID, () => {
  const hash = 'a'.repeat(16);
  it('compara só com texto extraído e hash válido', () => {
    expect(canCompareSimilarity({ status: 'extracted', simhash: hash })).toBe(true);
  });
  it.each(['needs_text', 'needs_ocr', 'extraction_failed'])('não compara em %s', (status) => {
    expect(canCompareSimilarity({ status, simhash: hash })).toBe(false);
  });
  it.each([null, 'abc', 'g'.repeat(16)])('não compara com hash %s', (simhash) => {
    expect(canCompareSimilarity({ status: 'extracted', simhash })).toBe(false);
  });
});
