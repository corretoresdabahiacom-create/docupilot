import { describe, expect, it } from 'vitest';
import { MAX_UNITS } from '../compare_util';
import { diffText, PATTERN_ID } from './diff_textual';

const page = (text: string, pageNumber = 1) => ({ pageNumber, text });

describe(PATTERN_ID, () => {
  it('textos idênticos: só partes iguais e similaridade 1', () => {
    const d = diffText([page('a\nb\nc')], [page('a\nb\nc')]);
    expect(d.hunks.map((h) => h.kind)).toEqual(['equal']);
    expect(d.stats).toEqual({ equal: 3, removed: 0, added: 0, changed: 0 });
    expect(d.similarity).toBe(1);
  });

  it('linha adicionada', () => {
    const d = diffText([page('a\nc')], [page('a\nb\nc')]);
    expect(d.hunks.map((h) => h.kind)).toEqual(['equal', 'added', 'equal']);
    expect(d.stats.added).toBe(1);
    expect(d.hunks[1]?.b[0]?.text).toBe('b');
  });

  it('linha removida', () => {
    const d = diffText([page('a\nb\nc')], [page('a\nc')]);
    expect(d.stats.removed).toBe(1);
    expect(d.hunks.find((h) => h.kind === 'removed')?.a[0]?.text).toBe('b');
  });

  it('linha alterada vira "changed" com diff de palavras', () => {
    const d = diffText([page('O prazo é de 30 dias.')], [page('O prazo é de 45 dias.')]);
    expect(d.stats.changed).toBe(1);
    const h = d.hunks[0];
    expect(h?.kind).toBe('changed');
    const inline = h?.inline?.[0] ?? [];
    expect(inline.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['30']);
    expect(inline.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['45']);
  });

  it('bloco de tamanhos diferentes sem linhas parecidas: removido + adicionado', () => {
    const d = diffText([page('alfa beta\ngama delta')], [page('zeta eta theta')]);
    expect(d.hunks.map((h) => h.kind)).toEqual(['removed', 'added']);
    expect(d.stats).toMatchObject({ removed: 2, added: 1, changed: 0 });
  });

  it('edição ao lado de uma inclusão: a linha editada continua "changed"', () => {
    const d = diffText(
      [page('Valor: R$ 1.000,00\nPrazo: 30 dias')],
      [page('Valor: R$ 1.250,00\nPrazo: 45 dias\nForo: capital')],
    );
    expect(d.stats).toMatchObject({ changed: 2, added: 1, removed: 0 });
    expect(d.hunks.map((h) => h.kind)).toEqual(['changed', 'added']);
  });

  it('linha removida entre duas editadas mantém os pares', () => {
    const d = diffText(
      [page('Valor: R$ 1.000,00\nlinha apagada inteira\nPrazo: 30 dias')],
      [page('Valor: R$ 2.000,00\nPrazo: 45 dias')],
    );
    expect(d.stats).toMatchObject({ changed: 2, removed: 1, added: 0 });
  });

  it('cada lado mantém suas próprias páginas (partes iguais)', () => {
    const d = diffText(
      [page('um', 1), page('dois', 2)],
      [page('novo', 1), page('um', 2), page('dois', 3)],
    );
    const eq = d.hunks.find((h) => h.kind === 'equal');
    expect(eq?.a.map((u) => u.pageNumber)).toEqual([1, 2]);
    expect(eq?.b.map((u) => u.pageNumber)).toEqual([2, 3]);
  });

  it('ignora diferença só de espaços e quebras', () => {
    const d = diffText([page('um   texto  \n\n  outro')], [page('um texto\noutro')]);
    expect(d.stats).toEqual({ equal: 2, removed: 0, added: 0, changed: 0 });
  });

  it('diferença de maiúsculas conta como alteração', () => {
    const d = diffText([page('Contrato')], [page('contrato')]);
    expect(d.stats.changed).toBe(1);
  });

  it('dois lados vazios: similaridade 1; um lado vazio: 0', () => {
    expect(diffText([], []).similarity).toBe(1);
    const d = diffText([], [page('a')]);
    expect(d.similarity).toBe(0);
    expect(d.stats.added).toBe(1);
  });

  it('linhas longas são divididas em frases', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Frase número ${i} termina aqui.`).join(' ');
    const d = diffText([page(long)], [page(long.replace('número 7 ', 'número 77 '))]);
    expect(d.stats.changed).toBe(1);
    expect(d.stats.equal).toBeGreaterThan(15);
  });

  it('corta em MAX_UNITS e avisa', () => {
    const many = Array.from({ length: MAX_UNITS + 5 }, (_, i) => `linha ${i}`).join('\n');
    const d = diffText([page(many)], [page('linha 0')]);
    expect(d.truncated).toEqual({ a: true, b: false });
    expect(d.unitsA).toBe(MAX_UNITS);
  });
});
