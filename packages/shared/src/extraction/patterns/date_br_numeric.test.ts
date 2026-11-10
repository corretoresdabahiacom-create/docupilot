import { describe, expect, it } from 'vitest';
import type { Lang } from '../types';
import { extractDateBR, PATTERN_ID } from './date_br_numeric';

const run = (t: string, language?: Lang) => extractDateBR(t, 'd1', 1, { language });

describe(PATTERN_ID, () => {
  it.each([
    ['10/12/2026', '2026-12-10'],
    ['01-02-2024', '2024-02-01'],
    ['31.12.1999', '1999-12-31'],
    ['5/3/24', '2024-03-05'],
    ['29/02/2024', '2024-02-29'],
    ['15/08/75', '1975-08-15'],
    ['1/1/2000', '2000-01-01'],
  ])('normaliza %s', (raw, iso) => {
    const f = run(`em ${raw}.`, 'pt');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ normalized_value: iso, confidence: 0.9, field_type: 'date' });
  });

  it.each([
    '30/02/2024',
    '31/04/2024',
    '32/01/2024',
    '10/13/2024',
    '00/10/2024',
    '10/12/1850',
    '10/12/2101',
    '10/12/20245',
    '1/2',
    '10/12',
  ])('rejeita %s', (raw) => {
    expect(run(`em ${raw}.`, 'pt')).toHaveLength(0);
  });

  it('ambígua com idioma indefinido cai para 0.7; sem ambiguidade fica 0.9', () => {
    expect(run('01/02/2024', 'und')[0]).toMatchObject({
      confidence: 0.7,
      normalized_value: '2024-02-01',
    });
    expect(run('25/02/2024', 'und')[0]!.confidence).toBe(0.9);
    expect(run('01/02/2024', 'pt')[0]!.confidence).toBe(0.9);
  });

  it('em inglês, ambígua com "/" fica para date_us_numeric', () => {
    expect(run('01/02/2024', 'en')).toHaveLength(0);
    expect(run('25/02/2024', 'en')).toHaveLength(1);
  });

  it('não casa dentro de data ISO nem de numeração maior', () => {
    expect(run('2026-12-10', 'pt')).toHaveLength(0);
    expect(run('10/12/2026/1', 'pt')).toHaveLength(0);
  });
});
