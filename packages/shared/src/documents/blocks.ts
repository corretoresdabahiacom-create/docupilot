/**
 * Modelo simples de blocos, comum a TXT, Markdown, HTML, PDF e DOCX. Só o que o editor produz:
 * parágrafos, títulos, listas, citações, código, linha, tabelas básicas e imagens. Nada de
 * colunas, imagens flutuantes ou cabeçalhos condicionais (limitação declarada, D15).
 */
import type { DocNode, DocRoot } from './doc';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
  /** Quebra de linha dentro do parágrafo. */
  br?: boolean;
}
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'table'; rows: Array<Array<{ header: boolean; blocks: Block[] }>> }
  | { type: 'image'; src: string; alt: string };

function runs(nodes: DocNode[] | undefined): Run[] {
  const out: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') out.push({ text: '', br: true });
    else if (n.type === 'text' && n.text) {
      const r: Run = { text: n.text };
      for (const m of n.marks ?? []) {
        if (m.type === 'link') r.href = m.attrs.href;
        else r[m.type] = true;
      }
      out.push(r);
    }
  }
  return out;
}

function toBlocks(nodes: DocNode[] | undefined): Block[] {
  const out: Block[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': {
        const img = (n.content ?? []).filter((c) => c.type === 'image');
        for (const i of img) out.push(imageBlock(i));
        out.push({ type: 'paragraph', runs: runs(n.content?.filter((c) => c.type !== 'image')) });
        break;
      }
      case 'heading':
        out.push({
          type: 'heading',
          level: Math.min(3, Math.max(1, Number(n.attrs?.['level'] ?? 2))) as 1 | 2 | 3,
          runs: runs(n.content),
        });
        break;
      case 'bulletList':
      case 'orderedList':
        out.push({
          type: 'list',
          ordered: n.type === 'orderedList',
          start: Number(n.attrs?.['start'] ?? 1),
          items: (n.content ?? []).map((li) => toBlocks(li.content)),
        });
        break;
      case 'blockquote':
        out.push({ type: 'quote', blocks: toBlocks(n.content) });
        break;
      case 'codeBlock':
        out.push({ type: 'code', text: (n.content ?? []).map((c) => c.text ?? '').join('') });
        break;
      case 'horizontalRule':
        out.push({ type: 'rule' });
        break;
      case 'image':
        out.push(imageBlock(n));
        break;
      case 'table':
        out.push({
          type: 'table',
          rows: (n.content ?? []).map((tr) =>
            (tr.content ?? []).map((cell) => ({
              header: cell.type === 'tableHeader',
              blocks: toBlocks(cell.content),
            })),
          ),
        });
        break;
      default:
    }
  }
  return out;
}
const imageBlock = (n: DocNode): Block => ({
  type: 'image',
  src: String(n.attrs?.['src'] ?? ''),
  alt: String(n.attrs?.['alt'] ?? ''),
});

export const docToBlocks = (doc: DocRoot): Block[] => toBlocks(doc.content);

export const runsText = (rs: Run[]): string => rs.map((r) => (r.br ? '\n' : r.text)).join('');
