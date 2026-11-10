import { describe, expect, it } from 'vitest';
import { PATTERN_ID, splitSentences, summarize } from './summary_textrank';

const pages = [
  {
    pageNumber: 1,
    text:
      'O contrato de locação residencial é celebrado entre o locador e o locatário para o imóvel situado na capital. ' +
      'O aluguel mensal do imóvel será pago pelo locatário até o dia dez de cada mês ao locador. ' +
      'O locador entrega o imóvel ao locatário em perfeito estado de conservação no dia 01/02/2024. ' +
      'O prazo da locação do imóvel é de trinta meses contados da entrega das chaves ao locatário. ' +
      'Chove muito em Salvador durante o outono segundo os moradores antigos da região costeira.',
  },
  {
    pageNumber: 2,
    text:
      'O locatário pagará o aluguel do imóvel mensalmente e o locador emitirá recibo do aluguel pago. ' +
      'A rescisão do contrato de locação antes do prazo implica multa proporcional ao tempo restante do aluguel. ' +
      'O pagamento final do aluguel ocorrerá em 15/08/2026 conforme o contrato de locação do imóvel. ' +
      'As partes elegem o foro da comarca da capital para dirimir dúvidas sobre o contrato de locação.',
  },
];

describe(PATTERN_ID, () => {
  it('executivo: no máximo 5 frases, todas ORIGINAIS do documento, em ordem', () => {
    const r = summarize(pages, 'executive');
    const sentences = r.groups[0]!.sentences;
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.length).toBeLessThanOrEqual(5);
    for (const s of sentences) {
      const page = pages.find((p) => p.pageNumber === s.pageNumber)!;
      expect(page.text.slice(s.start, s.end).replace(/\s+/g, ' ')).toBe(s.text);
    }
    const order = sentences.map((s) => s.pageNumber * 100000 + s.start);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('a frase fora do tema (chuva) não entra no resumo executivo', () => {
    const r = summarize(pages, 'executive');
    expect(r.groups[0]!.sentences.some((s) => s.text.includes('Chove'))).toBe(false);
  });

  it('tópicos: até 10 frases agrupadas', () => {
    const r = summarize(pages, 'topics');
    const total = r.groups.reduce((n, g) => n + g.sentences.length, 0);
    expect(total).toBeLessThanOrEqual(10);
    expect(total).toBeGreaterThan(0);
  });

  it('cronológico: só frases com data, ordenadas pela data', () => {
    const r = summarize(pages, 'chronological');
    const s = r.groups[0]!.sentences;
    expect(s.map((x) => x.date)).toEqual(['2024-02-01', '2026-08-15']);
  });

  it('cronológico sem datas devolve vazio (não inventa)', () => {
    const r = summarize(
      [{ pageNumber: 1, text: pages[0]!.text.replace('01/02/2024', 'ontem') }],
      'chronological',
    );
    expect(r.groups).toEqual([]);
  });

  it('documento sem frases úteis devolve vazio', () => {
    expect(summarize([{ pageNumber: 1, text: 'Oi. Ok.' }], 'executive').groups).toEqual([]);
  });

  it('splitSentences respeita abreviações e decimais', () => {
    const s = splitSentences(
      'O Sr. Silva pagou R$ 1.234,56 ao Dr. Souza conforme o art. 5 do contrato firmado. Outra frase completa aqui no texto.',
      1,
    );
    expect(s).toHaveLength(2);
    expect(s[0]!.text).toContain('R$ 1.234,56');
  });
});
