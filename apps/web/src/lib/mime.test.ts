import { describe, expect, it } from 'vitest';
import { guessMime } from './mime';

describe('guessMime', () => {
  it('usa o tipo informado pelo navegador quando existe', () => {
    expect(guessMime({ name: 'a.pdf', type: 'application/pdf' })).toBe('application/pdf');
  });
  it('completa pela extensão quando o tipo vem vazio', () => {
    expect(guessMime({ name: 'nota.MD', type: '' })).toBe('text/markdown');
    expect(guessMime({ name: 'dados.csv', type: '' })).toBe('text/csv');
  });
  it('mantém desconhecido como está (o servidor recusa)', () => {
    expect(guessMime({ name: 'x.exe', type: '' })).toBe('');
  });
});
