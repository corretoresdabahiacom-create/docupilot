import { describe, expect, it } from 'vitest';
import { docStats, emptyDoc, MAX_DOC_DEPTH, parseDoc, safeHref, validateDoc } from './doc';

const p = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks }],
});
const wrap = (...content: unknown[]) => ({ type: 'doc', content });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('validateDoc — aceita o que o editor produz', () => {
  it('parágrafo com marcas, título, listas, tabela, imagem e link', () => {
    const r = validateDoc(
      wrap(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] },
        p('oi', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://a.com/x?y=1' } }]),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('a')] }] },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [p('b')] }],
        },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('h')] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('c')] }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'x' } }] },
        { type: 'blockquote', content: [p('q')] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
        { type: 'horizontalRule' },
      ),
    );
    expect(r.ok).toBe(true);
  });
  it('documento vazio vira um parágrafo vazio', () => {
    expect(validateDoc({ type: 'doc', content: [] })).toEqual({ ok: true, doc: emptyDoc() });
  });
  it('remove atributos desconhecidos e normaliza valores fora de faixa', () => {
    const r = validateDoc(
      wrap({
        type: 'heading',
        attrs: { level: 9, onclick: 'x()', style: 'color:red' },
        content: [{ type: 'text', text: 'T' }],
      }),
    );
    expect(r.ok && r.doc.content[0]?.attrs).toEqual({ level: 2 });
  });
  it('descarta caracteres de controle do texto, mantendo quebra de linha', () => {
    const r = validateDoc(wrap(p('a\u0000b\u0007c\nd')));
    expect(r.ok && r.doc.content[0]?.content?.[0]?.text).toBe('abc\nd');
  });
  it('parseDoc aceita JSON; recusa JSON quebrado', () => {
    expect(parseDoc(JSON.stringify(wrap(p('x')))).ok).toBe(true);
    expect(parseDoc('{nope')).toEqual({ ok: false, error: 'JSON inválido' });
  });
});

describe('validateDoc — recusa o que não é do editor', () => {
  it.each([
    ['nó desconhecido (script)', wrap({ type: 'script', content: [] })],
    ['iframe', wrap({ type: 'iframe' })],
    ['marca desconhecida', wrap(p('x', [{ type: 'highlight' }]))],
    ['link javascript:', wrap(p('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))],
    ['link data:', wrap(p('x', [{ type: 'link', attrs: { href: 'data:text/html,<b>' } }]))],
    ['imagem remota', wrap({ type: 'image', attrs: { src: 'https://x.com/a.png' } })],
    ['imagem SVG', wrap({ type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz4=' } })],
    ['nó no lugar errado', wrap({ type: 'listItem', content: [] })],
    [
      'célula com lista dentro de parágrafo',
      wrap({
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'tableRow' }] }] },
        ],
      }),
    ],
    ['raiz errada', { type: 'paragraph' }],
    ['não é objeto', 'texto'],
    ['texto sem string', wrap({ type: 'paragraph', content: [{ type: 'text', text: 5 }] })],
  ])('%s', (_n, input) => {
    expect(validateDoc(input).ok).toBe(false);
  });
  it('profundidade excessiva', () => {
    let node: unknown = p('fundo');
    for (let i = 0; i < MAX_DOC_DEPTH + 2; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(validateDoc(wrap(node)).ok).toBe(false);
  });
  it('documento grande demais', () => {
    expect(
      validateDoc(
        wrap(p('x'.repeat(19_000)), ...Array.from({ length: 60 }, () => p('y'.repeat(19_000)))),
      ).ok,
    ).toBe(false);
  });
});

describe('safeHref', () => {
  it.each(['https://a.com', 'http://a.com/x', 'mailto:a@b.com'])('aceita %s', (h) => {
    expect(safeHref(h)).toBe(h);
  });
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:1',
    'data:text/html,x',
    '//a.com',
    '/x',
    'ftp://a.com',
    'https://a.com/ x',
    '',
    ' ',
    5,
    null,
  ])('recusa %s', (h) => {
    expect(safeHref(h)).toBeNull();
  });
});

describe('docStats', () => {
  it('conta palavras e caracteres', () => {
    const r = validateDoc(wrap(p('um dois três')));
    if (!r.ok) throw new Error(r.error);
    expect(docStats(r.doc)).toEqual({ chars: 12, words: 3 });
    expect(docStats(emptyDoc())).toEqual({ chars: 0, words: 0 });
  });
});
