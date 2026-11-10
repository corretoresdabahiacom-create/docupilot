import { describe, expect, it } from 'vitest';
import type { Lang } from '../types';
import { extractDateUS, PATTERN_ID } from './date_us_numeric';

const run = (t: string, language?: Lang) => extractDateUS(t, 'd1', 1, { language });

describe(PATTERN_ID, () => {
  it.each([
    ['01/02/2024', '2024-01-02'],
    ['12/11/2023', '2023-12-11'],
    ['03/04/99', '1999-03-04'],
    ['2/3/2020', '2020-02-03'],
    ['10/09/2025', '2025-10-09'],
    ['07/08/2022', '2022-07-08'],
  ])('em inglês normaliza %s', (raw, iso) => {
    const f = run(`Due ${raw}.`, 'en');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ normalized_value: iso, confidence: 0.9, field_type: 'date' });
  });

  it.each(['pt', 'es', 'und'] as const)('só atua em inglês (idioma %s)', (l) => {
    expect(run('01/02/2024', l)).toHaveLength(0);
  });

  it.each(['13/02/2024', '02/13/2024', '02/30/2024', '05/05/2024', '01-02-2024', '01.02.2024'])(
    'rejeita %s',
    (raw) => {
      expect(run(`Due ${raw}.`, 'en')).toHaveLength(0);
    },
  );
});
