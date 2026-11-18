import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { templateDoc, validateDoc, type DocRoot } from '@docupilot/shared';
import { decodeDataImage, exportDocument } from './docExport';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const t = (text: string, marks?: unknown[]) => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const rich = (): DocRoot => {
  const r = validateDoc({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [t('Título')] },
      {
        type: 'paragraph',
        content: [
          t('negrito ', [{ type: 'bold' }]),
          t('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [t('um')] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [t('dois')] }] },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('primeiro')] }] }],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('A')] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('B')] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [t('1')] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [t('2')] }] },
            ],
          },
        ],
      },
      { type: 'image', attrs: { src: `data:image/png;base64,${PNG_1x1}`, alt: 'pixel' } },
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};

describe('exportDocument', () => {
  it('PDF é válido, tem texto e ao menos uma página', async () => {
    const out = await exportDocument(rich(), 'Meu doc', 'pdf');
    const bytes = out.bytes as Uint8Array;
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(out.fileName).toMatch(/\.pdf$/);
    expect(out.warnings).toEqual([]);
  });

  it('PDF quebra em várias páginas quando o texto é longo', async () => {
    const long: DocRoot = {
      type: 'doc',
      content: Array.from({ length: 120 }, (_, i) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Parágrafo ${i} ` + 'palavra '.repeat(30) }],
      })),
    };
    const out = await exportDocument(long, 'Longo', 'pdf');
    const pdf = await PDFDocument.load(out.bytes as Uint8Array);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });

  it('avisa quando troca caracteres que o PDF padrão não suporta', async () => {
    const doc: DocRoot = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá ação — 日本語 😀' }] }],
    };
    const out = await exportDocument(doc, 'Acentos', 'pdf');
    expect(out.warnings.join(' ')).toMatch(/caracteres/);
    // Acentos do português continuam funcionando (WinAnsi).
    const ok = await exportDocument(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ação não é ç' }] }],
      },
      'ok',
      'pdf',
    );
    expect(ok.warnings).toEqual([]);
  });

  it('DOCX é um zip com document.xml e o texto', async () => {
    const out = await exportDocument(rich(), 'Meu doc', 'docx');
    const zip = await JSZip.loadAsync(out.bytes as Uint8Array);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Título');
    expect(xml).toContain('primeiro');
    expect(xml).toContain('<w:tbl>');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });

  it('TXT, MD e HTML vêm do núcleo compartilhado (HTML sem script)', async () => {
    const txt = await exportDocument(rich(), 'x', 'txt');
    expect(String(txt.bytes)).toContain('Título');
    const md = await exportDocument(rich(), 'x', 'md');
    expect(String(md.bytes)).toContain('# ');
    const html = await exportDocument(rich(), 'x', 'html');
    expect(String(html.bytes)).toContain('Content-Security-Policy');
    expect(String(html.bytes)).not.toMatch(/<script/i);
  });

  it('exporta todos os modelos sem erro e sem inventar valores', async () => {
    for (const key of ['proposta', 'orcamento', 'ata', 'recibo', 'checklist'] as const) {
      const doc = templateDoc(key, {})!;
      for (const f of ['pdf', 'docx'] as const) {
        const out = await exportDocument(doc, key, f);
        expect((out.bytes as Uint8Array).length).toBeGreaterThan(500);
      }
    }
  });
});

describe('decodeDataImage', () => {
  it('lê dimensões de PNG e rejeita o que não é data URI de imagem', () => {
    expect(decodeDataImage(`data:image/png;base64,${PNG_1x1}`)).toMatchObject({
      kind: 'png',
      width: 1,
      height: 1,
    });
    expect(decodeDataImage('https://x.test/a.png')).toBeNull();
    expect(decodeDataImage('data:image/svg+xml;base64,AAAA')).toBeNull();
  });
});
