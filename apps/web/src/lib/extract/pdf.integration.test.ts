// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// No Node usa-se a build "legacy" do pdfjs (sem DOM); a lógica de extração é a mesma.
vi.mock('../pdf', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return {
    openPdf: (data: ArrayBuffer) =>
      pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false }).promise,
  };
});

import { extractPdf } from './pdf';

/** PDF mínimo com uma linha de texto por página (texto vazio = página sem camada de texto). */
function makePdf(pages: string[]): Blob {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    const contentId = 4 + i * 2;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`,
    );
    const stream = text ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET` : '';
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out]);
}

describe('extractPdf com pdfjs real', () => {
  it('extrai o texto de cada página, na ordem, com a numeração correta', async () => {
    const r = await extractPdf(
      makePdf([
        'Contrato de locacao residencial firmado entre as partes',
        'Clausula segunda o valor do aluguel mensal e de mil reais',
      ]),
    );
    expect(r.status).toBe('extracted');
    if (r.status === 'extracted') {
      expect(r.pageCount).toBe(2);
      expect(r.pages[0]).toEqual({
        pageNumber: 1,
        text: 'Contrato de locacao residencial firmado entre as partes',
      });
      expect(r.pages[1]!.text).toContain('aluguel mensal');
    }
  });

  it('PDF sem camada de texto vira needs_ocr', async () => {
    expect(await extractPdf(makePdf(['', '']))).toEqual({ status: 'needs_ocr', pageCount: 2 });
  });

  it('bytes que não são PDF viram extraction_failed (read_error)', async () => {
    expect(await extractPdf(new Blob(['isto não é um pdf']))).toEqual({
      status: 'extraction_failed',
      reason: 'read_error',
    });
  });
});
