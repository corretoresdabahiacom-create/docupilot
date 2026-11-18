import { describe, expect, it } from 'vitest';
import type { DocRoot } from './doc';
import { validateDoc } from './doc';
import { docExportFileName, docToHtml, docToMarkdown, docToText, escapeHtml } from './export';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, marks });
const par = (...c: unknown[]) => ({ type: 'paragraph', content: c });
function mk(...content: unknown[]): DocRoot {
  const r = validateDoc({ type: 'doc', content });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}
const li = (t: string) => ({ type: 'listItem', content: [par(text(t))] });
const table = {
  type: 'table',
  content: [
    {
      type: 'tableRow',
      content: [
        { type: 'tableHeader', content: [par(text('Item'))] },
        { type: 'tableHeader', content: [par(text('Valor'))] },
      ],
    },
    {
      type: 'tableRow',
      content: [
        { type: 'tableCell', content: [par(text('A|B'))] },
        { type: 'tableCell', content: [par(text('10'))] },
      ],
    },
  ],
};
const sample = mk(
  { type: 'heading', attrs: { level: 1 }, content: [text('Título')] },
  par(
    text('normal '),
    text('negrito', [{ type: 'bold' }]),
    text(' '),
    text('link', [{ type: 'link', attrs: { href: 'https://a.com/x' } }]),
  ),
  { type: 'bulletList', content: [li('um'), li('dois')] },
  { type: 'orderedList', attrs: { start: 1 }, content: [li('a'), li('b')] },
  table,
  { type: 'blockquote', content: [par(text('citação'))] },
  { type: 'codeBlock', content: [text('x = 1')] },
  { type: 'horizontalRule' },
  par({ type: 'image', attrs: { src: PNG, alt: 'foto' } }),
);

describe('docToText', () => {
  const out = docToText(sample, 'Meu doc');
  it('título, parágrafos, listas e tabela em texto puro', () => {
    expect(out).toContain('Meu doc\n=======');
    expect(out).toContain('normal negrito link');
    expect(out).toContain('- um\n- dois');
    expect(out).toContain('1. a\n2. b');
    expect(out).toContain('Item\tValor');
    expect(out).toContain('> citação');
    expect(out).toContain('[imagem: foto]');
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('docToMarkdown', () => {
  const out = docToMarkdown(sample, 'Meu doc');
  it('estrutura em Markdown', () => {
    expect(out).toContain('# Meu doc');
    expect(out).toContain('# Título');
    expect(out).toContain('**negrito**');
    expect(out).toContain('[link](https://a.com/x)');
    expect(out).toContain('- um\n- dois');
    expect(out).toContain('1. a\n2. b');
    expect(out).toContain('> citação');
    expect(out).toContain('| Item | Valor |');
    expect(out).toContain('| --- | --- |');
  });
  it('escapa barra vertical em tabela e marcação no texto', () => {
    expect(out).toContain('A\\|B');
    const d = mk(par(text('*não* é [link](x) # nem <b>')));
    const md = docToMarkdown(d);
    expect(md).toContain('\\*não\\*');
    expect(md).toContain('\\[link\\]\\(x\\)');
    expect(md).toContain('\\<b\\>');
  });
});

describe('docToHtml', () => {
  const html = docToHtml(sample, 'Meu <doc>');
  it('é um documento completo, sem script e com CSP', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<title>Meu &lt;doc&gt;</title>');
    expect(html).toContain('<strong>negrito</strong>');
    expect(html).toContain('<a href="https://a.com/x" rel="noopener noreferrer">link</a>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain(`<img src="${PNG}" alt="foto">`);
  });
  it('escapa texto de terceiros (sem injeção de HTML)', () => {
    const evil = mk(par(text('<img src=x onerror=alert(1)>"\'&')), {
      type: 'heading',
      attrs: { level: 2 },
      content: [text('<script>x</script>')],
    });
    const out = docToHtml(evil, '"><script>1</script>');
    expect(out).not.toContain('<img src=x');
    expect(out).not.toMatch(/<script>/i);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
  });
  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('docExportFileName', () => {
  it.each([
    ['Proposta Ação 2026', 'pdf', 'Proposta_Acao_2026.pdf'],
    ['../../etc/passwd', 'txt', 'etc_passwd.txt'],
    ['   ', 'md', 'documento.md'],
    ['a'.repeat(200), 'html', `${'a'.repeat(80)}.html`],
    ['CON:*?"<>|', 'docx', 'CON.docx'],
  ] as const)('%s → %s', (t, f, expected) => {
    expect(docExportFileName(t, f)).toBe(expected);
  });
});
