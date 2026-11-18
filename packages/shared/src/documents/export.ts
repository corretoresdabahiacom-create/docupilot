/** Exportações sem dependências: TXT, Markdown e HTML (D15). PDF e DOCX ficam em apps/web. */
import type { Block, Run } from './blocks';
import { docToBlocks, runsText } from './blocks';
import type { DocRoot } from './doc';
import { safeHref } from './doc';

export const DOC_EXPORT_FORMATS = ['pdf', 'docx', 'html', 'md', 'txt'] as const;
export type DocExportFormat = (typeof DOC_EXPORT_FORMATS)[number];

// ---------- TXT ----------

function textBlocks(blocks: Block[], indent: string): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        out.push(indent + runsText(b.runs));
        break;
      case 'quote':
        out.push(...textBlocks(b.blocks, `${indent}> `));
        break;
      case 'code':
        out.push(...b.text.split('\n').map((l) => `${indent}    ${l}`));
        break;
      case 'rule':
        out.push(`${indent}----------------------------------------`);
        break;
      case 'image':
        out.push(`${indent}[imagem${b.alt ? `: ${b.alt}` : ''}]`);
        break;
      case 'list':
        b.items.forEach((item, i) => {
          const marker = b.ordered ? `${b.start + i}. ` : '- ';
          const inner = textBlocks(item, indent + ' '.repeat(marker.length));
          while (inner.length && inner[inner.length - 1] === '') inner.pop();
          if (inner.length) inner[0] = indent + marker + (inner[0] ?? '').trimStart();
          out.push(...inner);
        });
        break;
      case 'table':
        for (const row of b.rows) {
          out.push(
            indent +
              row
                .map((c) => textBlocks(c.blocks, '').join(' ').replace(/\s+/g, ' ').trim())
                .join('\t'),
          );
        }
        break;
    }
    out.push('');
  }
  return out;
}

export function docToText(doc: DocRoot, title?: string): string {
  const body = textBlocks(docToBlocks(doc), '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${title ? `${title}\n${'='.repeat(Math.min(title.length, 60))}\n\n` : ''}${body}\n`;
}

// ---------- Markdown ----------

const MD_SPECIAL = /([\\`*_{}[\]()#+\-.!|<>~])/g;
const mdEscape = (s: string) => s.replace(MD_SPECIAL, '\\$1');

function mdRuns(rs: Run[]): string {
  return rs
    .map((r) => {
      if (r.br) return '  \n';
      let t = r.code ? `\`${r.text.replace(/`/g, "'")}\`` : mdEscape(r.text);
      if (r.bold) t = `**${t}**`;
      if (r.italic) t = `*${t}*`;
      if (r.strike) t = `~~${t}~~`;
      if (r.href) t = `[${t}](${r.href.replace(/[()\s]/g, encodeURIComponent)})`;
      return t;
    })
    .join('');
}

function mdBlocks(blocks: Block[], prefix: string): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`${prefix}${'#'.repeat(b.level)} ${mdRuns(b.runs)}`);
        break;
      case 'paragraph':
        out.push(prefix + mdRuns(b.runs));
        break;
      case 'quote':
        out.push(...mdBlocks(b.blocks, `${prefix}> `));
        break;
      case 'code':
        out.push(
          `${prefix}\`\`\``,
          ...b.text.split('\n').map((l) => prefix + l),
          `${prefix}\`\`\``,
        );
        break;
      case 'rule':
        out.push(`${prefix}---`);
        break;
      case 'image':
        out.push(`${prefix}*[imagem${b.alt ? `: ${mdEscape(b.alt)}` : ''}]*`);
        break;
      case 'list':
        b.items.forEach((item, i) => {
          const marker = b.ordered ? `${b.start + i}. ` : '- ';
          const inner = mdBlocks(item, prefix + ' '.repeat(marker.length)).filter((l) => l !== '');
          if (inner.length)
            inner[0] = prefix + marker + (inner[0] ?? '').slice(prefix.length + marker.length);
          out.push(...inner);
        });
        break;
      case 'table': {
        const cell = (c: { blocks: Block[] }) =>
          mdBlocks(c.blocks, '').join(' ').replace(/\s+/g, ' ').trim();
        const rows = b.rows.map((r) => r.map(cell));
        const width = Math.max(1, ...rows.map((r) => r.length));
        const pad = (r: string[]) =>
          `${prefix}| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
        const [head = [], ...rest] = rows;
        out.push(
          pad(head),
          `${prefix}| ${Array(width).fill('---').join(' | ')} |`,
          ...rest.map(pad),
        );
        break;
      }
    }
    out.push('');
  }
  return out;
}

export function docToMarkdown(doc: DocRoot, title?: string): string {
  const body = mdBlocks(docToBlocks(doc), '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${title ? `# ${mdEscape(title)}\n\n` : ''}${body}\n`;
}

// ---------- HTML ----------

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function htmlRuns(rs: Run[]): string {
  return rs
    .map((r) => {
      if (r.br) return '<br>';
      let t = escapeHtml(r.text);
      if (r.code) t = `<code>${t}</code>`;
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      if (r.strike) t = `<s>${t}</s>`;
      const href = r.href ? safeHref(r.href) : null;
      if (href) t = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${t}</a>`;
      return t;
    })
    .join('');
}

function htmlBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `<h${b.level}>${htmlRuns(b.runs)}</h${b.level}>`;
        case 'paragraph':
          return `<p>${htmlRuns(b.runs)}</p>`;
        case 'quote':
          return `<blockquote>${htmlBlocks(b.blocks)}</blockquote>`;
        case 'code':
          return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
        case 'rule':
          return '<hr>';
        case 'image':
          return /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.src)
            ? `<img src="${b.src}" alt="${escapeHtml(b.alt)}">`
            : '';
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
          return `<${tag}${start}>${b.items.map((i) => `<li>${htmlBlocks(i)}</li>`).join('')}</${tag}>`;
        }
        case 'table':
          return `<table>${b.rows
            .map(
              (r) =>
                `<tr>${r
                  .map(
                    (c) =>
                      `<${c.header ? 'th' : 'td'}>${htmlBlocks(c.blocks)}</${c.header ? 'th' : 'td'}>`,
                  )
                  .join('')}</tr>`,
            )
            .join('')}</table>`;
      }
    })
    .join('\n');
}

/**
 * HTML autônomo, sem script e com CSP restritiva (só imagens embutidas). Serve também para
 * imprimir/salvar em PDF pelo navegador quando o layout simples do PDF não basta.
 */
export function docToHtml(doc: DocRoot, title: string, lang = 'pt-BR'): string {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:.35rem .5rem;text-align:left;vertical-align:top}
img{max-width:100%;height:auto}pre{background:#f3f3f3;padding:.75rem;overflow:auto}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:1rem;color:#444}
@media print{body{margin:0;max-width:none}a{color:inherit}}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${htmlBlocks(docToBlocks(doc))}
</body>
</html>
`;
}

/** Nome de arquivo seguro para a exportação. */
export function docExportFileName(title: string, format: DocExportFormat): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return `${base || 'documento'}.${format}`;
}
