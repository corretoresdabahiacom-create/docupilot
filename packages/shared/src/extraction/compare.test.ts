import { describe, expect, it } from 'vitest';
import {
  compare,
  comparisonRows,
  csvCell,
  exportFileName,
  toCsv,
  toJson,
  toMarkdown,
  type ExportMeta,
} from './compare';

const page = (text: string, pageNumber = 1) => ({ pageNumber, text });
const meta: ExportMeta = {
  leftLabel: 'v1',
  rightLabel: 'v2',
  generatedAt: '2026-11-11T10:00:00.000Z',
  notice: 'Comparação textual heurística; não é parecer jurídico.',
};

const A = [
  page(
    'CONTRATO\n1. Objeto\nPrestação de serviços.\n2. Preço\nValor total: R$ 1.000,00\nVencimento: 10/05/2026',
  ),
];
const B = [
  page(
    'CONTRATO\n1. Objeto\nPrestação de serviços.\n2. Preço\nValor total: R$ 1.250,00\nVencimento: 15/06/2026\n3. Foro\nComarca da capital.',
  ),
];

describe('compare', () => {
  const r = compare(A, B);

  it('reúne texto, campos e cláusulas', () => {
    expect(r.text.stats.changed).toBe(2);
    expect(r.text.stats.added).toBe(2);
    expect(r.fields.filter((f) => f.status === 'alterado')).toHaveLength(2);
    expect(r.clauses.stats).toMatchObject({ igual: 1, alterada: 1, adicionada: 1 });
  });

  it('linhas da tabela: campos primeiro, depois cláusulas, com origem', () => {
    const rows = comparisonRows(r);
    expect(rows[0]?.section).toBe('campo');
    expect(rows.at(-1)?.section).toBe('clausula');
    const venc = rows.find((x) => x.item === 'date — vencimento');
    expect(venc).toMatchObject({
      valueA: '2026-05-10',
      valueB: '2026-06-15',
      originA: 'p.1',
      originB: 'p.1',
    });
  });

  it('CSV: BOM, CRLF, aspas escapadas', () => {
    const csv = toCsv(comparisonRows(r));
    expect(csv.startsWith('﻿"seção","item"')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it('CSV neutraliza fórmulas vindas do documento', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('normal')).toBe('"normal"');
  });

  it('Markdown: escapa pipes e marcação, inclui aviso', () => {
    const md = toMarkdown(
      [
        {
          section: 'campo',
          item: 'a|b',
          status: 'igual',
          valueA: '<b>x</b>',
          originA: 'p.1',
          valueB: '[l](u)',
          originB: '',
        },
      ],
      meta,
    );
    expect(md).toContain('a\\|b');
    expect(md).toContain('\\<b\\>x\\</b\\>');
    expect(md).toContain('\\[l\\](u)');
    expect(md).toContain('não é parecer jurídico');
  });

  it('JSON válido, com método e sem partes iguais do texto', () => {
    const parsed = JSON.parse(toJson(r, meta));
    expect(parsed.method).toEqual(['diff_textual', 'diff_fields', 'diff_clause']);
    expect(parsed.text.changes.every((h: { kind: string }) => h.kind !== 'equal')).toBe(true);
    expect(parsed.meta.notice).toBe(meta.notice);
    expect(parsed.fields.length).toBe(r.fields.length);
  });

  it('nome de arquivo seguro', () => {
    expect(exportFileName('Contrato ../São João?.pdf', 'csv')).toBe('Contrato-.-Sao-Joao-.pdf.csv');
    expect(exportFileName('///', 'md')).toBe('comparacao.md');
    expect(exportFileName('a'.repeat(200), 'json').length).toBeLessThanOrEqual(65);
  });

  it('é determinístico', () => {
    expect(toJson(compare(A, B), meta)).toBe(toJson(compare(A, B), meta));
  });
});
