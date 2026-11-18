/**
 * Exportação do documento criado no navegador (D15). TXT/MD/HTML vêm de `@docupilot/shared`;
 * aqui ficam PDF (pdf-lib) e DOCX (docx), com layout SIMPLES: parágrafos, títulos, listas,
 * citações, código, linhas, tabelas básicas e imagens. Não promete PDF/Word complexo: para
 * layout elaborado, use HTML + imprimir do navegador.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  docExportFileName,
  docToBlocks,
  docToHtml,
  docToMarkdown,
  docToText,
  type Block,
  type DocExportFormat,
  type DocRoot,
  type Run,
} from '@docupilot/shared';

export interface ExportResult {
  bytes: Uint8Array | string;
  mime: string;
  fileName: string;
  /** Avisos honestos: caracteres/imagens que o formato não comporta. */
  warnings: string[];
}

export const MIME: Record<DocExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

// ---------- imagens ----------

export interface ImageData {
  kind: 'png' | 'jpg' | 'gif';
  bytes: Uint8Array;
  width: number;
  height: number;
}

export function decodeDataImage(src: string): ImageData | null {
  const m = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2] as string), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const kind = m[1] === 'jpeg' ? 'jpg' : (m[1] as 'png' | 'gif');
  const size = imageSize(kind, bytes);
  return size ? { kind, bytes, ...size } : null;
}

function imageSize(
  kind: 'png' | 'jpg' | 'gif',
  b: Uint8Array,
): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (kind === 'png') {
    if (b.length < 24) return null;
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (kind === 'gif') {
    if (b.length < 10) return null;
    return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] as number;
    const len = v.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

// ---------- PDF ----------

const PAGE = { w: 595.28, h: 841.89, margin: 56 };
const SIZES = { body: 11, h1: 20, h2: 16, h3: 13, code: 9.5 };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

class PdfWriter {
  page!: PDFPage;
  y = 0;
  readonly warnings = new Set<string>();
  private constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly allowed: Set<number>,
  ) {
    this.newPage();
  }

  static async create(): Promise<PdfWriter> {
    const pdf = await PDFDocument.create();
    const fonts: Fonts = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await pdf.embedFont(StandardFonts.Courier),
    };
    return new PdfWriter(pdf, fonts, new Set(fonts.regular.getCharacterSet()));
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - PAGE.margin;
  }
  ensure(height: number) {
    if (this.y - height < PAGE.margin) this.newPage();
  }

  /** Troca por "?" o que a fonte padrão (WinAnsi) não desenha, e avisa. */
  safe(text: string): string {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === '\t') out += '    ';
      else if (cp < 32) continue;
      else if (this.allowed.has(cp)) out += ch;
      else {
        out += '?';
        this.warnings.add('Alguns caracteres que o PDF padrão não suporta foram trocados por "?".');
      }
    }
    return out;
  }

  fontFor(r: Run, base: 'regular' | 'bold' = 'regular'): PDFFont {
    if (r.code) return this.fonts.mono;
    const bold = r.bold || base === 'bold';
    if (bold && r.italic) return this.fonts.boldItalic;
    if (bold) return this.fonts.bold;
    if (r.italic) return this.fonts.italic;
    return this.fonts.regular;
  }
}

interface Word {
  text: string;
  font: PDFFont;
  link: boolean;
  strike: boolean;
}

function wordsOf(w: PdfWriter, runs: Run[], base: 'regular' | 'bold'): Array<Word | 'br'> {
  const out: Array<Word | 'br'> = [];
  for (const r of runs) {
    if (r.br) {
      out.push('br');
      continue;
    }
    const font = w.fontFor(r, base);
    for (const part of w.safe(r.text).split(/(\s+)/)) {
      if (part) out.push({ text: part, font, link: Boolean(r.href), strike: Boolean(r.strike) });
    }
  }
  return out;
}

/** Escreve runs com quebra de linha por palavra, dentro de [x, x+width]. */
function drawRuns(
  w: PdfWriter,
  runs: Run[],
  opts: { x: number; width: number; size: number; base?: 'regular' | 'bold'; gap?: number },
): void {
  const { x, width, size } = opts;
  const lineH = size * 1.35;
  let line: Word[] = [];
  let used = 0;
  const flush = () => {
    while (line.length && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
    w.ensure(lineH);
    let cx = x;
    const baseY = w.y - size;
    for (const word of line) {
      const wd = word.font.widthOfTextAtSize(word.text, size);
      w.page.drawText(word.text, {
        x: cx,
        y: baseY,
        size,
        font: word.font,
        color: word.link ? rgb(0.1, 0.25, 0.75) : rgb(0.08, 0.08, 0.1),
      });
      if (word.link || word.strike) {
        const ly = word.strike ? baseY + size * 0.3 : baseY - 1.5;
        w.page.drawLine({
          start: { x: cx, y: ly },
          end: { x: cx + wd, y: ly },
          thickness: 0.6,
          color: word.link ? rgb(0.1, 0.25, 0.75) : rgb(0.08, 0.08, 0.1),
        });
      }
      cx += wd;
    }
    w.y -= lineH;
    line = [];
    used = 0;
  };
  const items = wordsOf(w, runs, opts.base ?? 'regular');
  if (items.length === 0) w.y -= lineH;
  for (const it of items) {
    if (it === 'br') {
      flush();
      continue;
    }
    const wd = it.font.widthOfTextAtSize(it.text, size);
    if (used + wd > width && line.length && !/^\s+$/.test(it.text)) flush();
    if (used === 0 && /^\s+$/.test(it.text)) continue;
    line.push(it);
    used += wd;
  }
  if (line.length) flush();
  w.y -= opts.gap ?? 0;
}

async function drawBlocks(
  w: PdfWriter,
  blocks: Block[],
  x: number,
  width: number,
  inCell = false,
): Promise<void> {
  const gap = inCell ? 2 : 7;
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const size = b.level === 1 ? SIZES.h1 : b.level === 2 ? SIZES.h2 : SIZES.h3;
        w.ensure(size * 2);
        w.y -= inCell ? 0 : 4;
        drawRuns(w, b.runs, { x, width, size, base: 'bold', gap });
        break;
      }
      case 'paragraph':
        drawRuns(w, b.runs, { x, width, size: SIZES.body, gap });
        break;
      case 'list':
        for (const [i, item] of b.items.entries()) {
          const marker = b.ordered ? `${b.start + i}.` : '•';
          w.ensure(SIZES.body * 1.5);
          w.page.drawText(w.safe(marker), {
            x,
            y: w.y - SIZES.body,
            size: SIZES.body,
            font: w.fonts.regular,
          });
          await drawBlocks(w, item, x + 18, width - 18, true);
        }
        w.y -= gap;
        break;
      case 'quote': {
        const top = w.y;
        const page = w.page;
        await drawBlocks(w, b.blocks, x + 14, width - 14, true);
        if (w.page === page) {
          page.drawLine({
            start: { x: x + 4, y: top },
            end: { x: x + 4, y: w.y + 2 },
            thickness: 1.5,
            color: rgb(0.7, 0.7, 0.75),
          });
        }
        w.y -= gap;
        break;
      }
      case 'code':
        for (const raw of b.text.split('\n')) {
          // Código é quebrado por largura (sem palavras): pedaços do tamanho que cabe.
          const line = w.safe(raw);
          const per = Math.max(
            8,
            Math.floor(width / w.fonts.mono.widthOfTextAtSize('M', SIZES.code)),
          );
          for (let i = 0; i === 0 || i < line.length; i += per) {
            w.ensure(SIZES.code * 1.4);
            w.page.drawText(line.slice(i, i + per), {
              x: x + 4,
              y: w.y - SIZES.code,
              size: SIZES.code,
              font: w.fonts.mono,
            });
            w.y -= SIZES.code * 1.4;
          }
        }
        w.y -= gap;
        break;
      case 'rule':
        w.ensure(10);
        w.page.drawLine({
          start: { x, y: w.y - 4 },
          end: { x: x + width, y: w.y - 4 },
          thickness: 0.8,
          color: rgb(0.6, 0.6, 0.65),
        });
        w.y -= 10 + gap;
        break;
      case 'image': {
        const img = decodeDataImage(b.src);
        if (!img || img.kind === 'gif') {
          drawRuns(w, [{ text: `[imagem${b.alt ? `: ${b.alt}` : ''} — não incluída no PDF]` }], {
            x,
            width,
            size: SIZES.body,
            gap,
          });
          w.warnings.add('Imagens GIF não são incluídas no PDF (use PNG ou JPEG).');
          break;
        }
        const embedded =
          img.kind === 'png' ? await w.pdf.embedPng(img.bytes) : await w.pdf.embedJpg(img.bytes);
        const scale = Math.min(1, width / embedded.width, 400 / embedded.height);
        const iw = embedded.width * scale;
        const ih = embedded.height * scale;
        w.ensure(ih);
        w.page.drawImage(embedded, { x, y: w.y - ih, width: iw, height: ih });
        w.y -= ih + gap;
        break;
      }
      case 'table': {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const cw = width / cols;
        for (const row of b.rows) {
          // Altura da linha: mede escrevendo numa página "fantasma" seria caro; estima por linhas.
          const est = Math.max(
            ...row.map((c) => {
              const text = c.blocks
                .map((cb) => ('runs' in cb ? cb.runs.map((r) => r.text).join('') : ''))
                .join(' ');
              const chars = Math.max(1, Math.floor((cw - 8) / (SIZES.body * 0.5)));
              return Math.max(1, Math.ceil(text.length / chars)) * SIZES.body * 1.35 + 8;
            }),
          );
          w.ensure(Math.min(est, PAGE.h - 2 * PAGE.margin));
          const top = w.y;
          const page = w.page;
          let bottom = top;
          for (const [ci, cell] of row.entries()) {
            w.page = page;
            w.y = top - 4;
            await drawBlocks(
              w,
              cell.blocks.map((cb) =>
                cell.header && cb.type === 'paragraph'
                  ? { ...cb, runs: cb.runs.map((r) => ({ ...r, bold: true })) }
                  : cb,
              ),
              x + ci * cw + 4,
              cw - 8,
              true,
            );
            bottom = Math.min(bottom, w.y);
          }
          const h = top - bottom + 4;
          for (let ci = 0; ci < row.length; ci++) {
            page.drawRectangle({
              x: x + ci * cw,
              y: top - h,
              width: cw,
              height: h,
              borderColor: rgb(0.65, 0.65, 0.7),
              borderWidth: 0.6,
            });
          }
          w.y = top - h;
        }
        w.y -= gap;
        break;
      }
    }
  }
}

export async function docToPdf(
  doc: DocRoot,
  title: string,
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const w = await PdfWriter.create();
  w.pdf.setTitle(w.safe(title));
  w.pdf.setProducer('DocuPilot AI');
  await drawBlocks(w, docToBlocks(doc), PAGE.margin, PAGE.w - 2 * PAGE.margin);
  return { bytes: await w.pdf.save(), warnings: [...w.warnings] };
}

// ---------- DOCX ----------

function docxRuns(runs: Run[]): ParagraphChild[] {
  return runs.map((r) => {
    if (r.br) return new TextRun({ break: 1 });
    const run = new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      strike: r.strike,
      font: r.code ? 'Courier New' : undefined,
    });
    if (r.href) {
      return new ExternalHyperlink({
        link: r.href,
        children: [
          new TextRun({ text: r.text, bold: r.bold, italics: r.italic, style: 'Hyperlink' }),
        ],
      });
    }
    return run;
  });
}

type DocxBlock = Paragraph | Table;
let orderedInstance = 0;

function docxBlocks(blocks: Block[], level = 0, quote = false, warn: Set<string>): DocxBlock[] {
  const out: DocxBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
              b.level - 1
            ],
            children: docxRuns(b.runs),
          }),
        );
        break;
      case 'paragraph':
        out.push(
          new Paragraph({
            children: docxRuns(b.runs),
            indent: quote ? { left: 480 } : undefined,
          }),
        );
        break;
      case 'list': {
        const instance = ++orderedInstance;
        for (const item of b.items) {
          const first = item.find((x) => x.type === 'paragraph' || x.type === 'heading');
          const runs = first && 'runs' in first ? first.runs : [];
          out.push(
            new Paragraph(
              b.ordered
                ? {
                    children: docxRuns(runs),
                    numbering: { reference: 'ol', level: Math.min(level, 4), instance },
                  }
                : { children: docxRuns(runs), bullet: { level: Math.min(level, 4) } },
            ),
          );
          out.push(
            ...docxBlocks(
              item.filter((x) => x !== first),
              level + 1,
              quote,
              warn,
            ),
          );
        }
        break;
      }
      case 'quote':
        out.push(...docxBlocks(b.blocks, level, true, warn));
        break;
      case 'code':
        for (const line of b.text.split('\n')) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New', size: 19 })],
            }),
          );
        }
        break;
      case 'rule':
        out.push(
          new Paragraph({
            border: { bottom: { style: 'single', size: 6, color: '999999', space: 1 } },
          }),
        );
        break;
      case 'image': {
        const img = decodeDataImage(b.src);
        if (!img) {
          warn.add('Uma imagem inválida não foi incluída no DOCX.');
          break;
        }
        const scale = Math.min(1, 520 / img.width);
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new ImageRun({
                type: img.kind,
                data: img.bytes,
                transformation: { width: img.width * scale, height: img.height * scale },
                altText: {
                  name: b.alt || 'imagem',
                  description: b.alt || 'imagem',
                  title: b.alt || 'imagem',
                },
              }),
            ],
          }),
        );
        break;
      }
      case 'table':
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map(
              (r) =>
                new TableRow({
                  children: r.map(
                    (c) =>
                      new TableCell({
                        children: ((): Paragraph[] => {
                          const inner = docxBlocks(
                            c.header
                              ? c.blocks.map((cb) =>
                                  cb.type === 'paragraph'
                                    ? { ...cb, runs: cb.runs.map((x) => ({ ...x, bold: true })) }
                                    : cb,
                                )
                              : c.blocks,
                            level,
                            quote,
                            warn,
                          ).filter((x): x is Paragraph => x instanceof Paragraph);
                          return inner.length ? inner : [new Paragraph('')];
                        })(),
                      }),
                  ),
                }),
            ),
          }),
        );
        out.push(new Paragraph(''));
        break;
    }
  }
  return out;
}

export async function docToDocx(
  doc: DocRoot,
  title: string,
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const warn = new Set<string>();
  orderedInstance = 0;
  const d = new Document({
    creator: 'DocuPilot AI',
    title,
    numbering: {
      config: [
        {
          reference: 'ol',
          levels: Array.from({ length: 5 }, (_, level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: docxBlocks(docToBlocks(doc), 0, false, warn) }],
  });
  // toBlob (não toBuffer): no navegador não existe `Buffer`.
  const blob = await Packer.toBlob(d);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), warnings: [...warn] };
}

// ---------- entrada única ----------

export async function exportDocument(
  doc: DocRoot,
  title: string,
  format: DocExportFormat,
  lang: 'pt' | 'en' = 'pt',
): Promise<ExportResult> {
  const fileName = docExportFileName(title, format);
  switch (format) {
    case 'txt':
      return { bytes: docToText(doc, title), mime: MIME.txt, fileName, warnings: [] };
    case 'md':
      return { bytes: docToMarkdown(doc, title), mime: MIME.md, fileName, warnings: [] };
    case 'html':
      return { bytes: docToHtml(doc, title, lang), mime: MIME.html, fileName, warnings: [] };
    case 'pdf':
      return { ...(await docToPdf(doc, title)), mime: MIME.pdf, fileName };
    case 'docx':
      return { ...(await docToDocx(doc, title)), mime: MIME.docx, fileName };
  }
}
