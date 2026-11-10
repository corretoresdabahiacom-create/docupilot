import { describe, expect, it } from 'vitest';
import { MAX_CHARS_PER_REQUEST, MAX_PAGES_PER_REQUEST } from '@docupilot/shared';
import { classifyPdfPages } from './classify';
import { extractFromBlob } from './index';
import { currentDevice, isDesktopDevice, ocrBlockReason, ocrWindow, type DeviceInfo } from './ocr';
import { splitIntoSections } from './sections';
import { batchPages } from './submit';
import { decodeText, extractPlainText, textToResult } from './text';

describe('splitIntoSections', () => {
  it('mantém texto curto numa seção e preserva parágrafos', () => {
    expect(splitIntoSections('a\n\nb')).toEqual(['a\n\nb']);
    expect(splitIntoSections('   \n ')).toEqual([]);
  });
  it('quebra em parágrafos sem passar do limite', () => {
    const text = Array.from({ length: 10 }, (_, i) => `parágrafo ${i} `.repeat(20)).join('\n\n');
    const parts = splitIntoSections(text, 600);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(600);
  });
  it('divide linhas gigantes no limite duro e não perde conteúdo', () => {
    const line = 'x'.repeat(2500);
    const parts = splitIntoSections(line, 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(parts.join('')).toBe(line);
  });
});

describe('classifyPdfPages', () => {
  const good = 'Contrato de prestação de serviços entre as partes, firmado em 2024.';
  it('PDF sem camada de texto → needs_ocr', () => {
    expect(classifyPdfPages(['', '  ', '\n'])).toEqual({ status: 'needs_ocr', pageCount: 3 });
    expect(classifyPdfPages(['p. 1', 'p. 2']).status).toBe('needs_ocr');
    expect(classifyPdfPages([]).status).toBe('needs_ocr');
  });
  it('texto ilegível → extraction_failed', () => {
    const r = classifyPdfPages(['�'.repeat(200), ''.repeat(200)]);
    expect(r).toMatchObject({ status: 'extraction_failed', reason: 'garbage_text' });
  });
  it('texto legível → extracted, ignorando páginas vazias mas mantendo a numeração', () => {
    const r = classifyPdfPages([good, '', good]);
    expect(r.status).toBe('extracted');
    if (r.status === 'extracted') {
      expect(r.pageCount).toBe(3);
      expect(r.pages.map((p) => p.pageNumber)).toEqual([1, 3]);
    }
  });
});

describe('texto simples', () => {
  it('decodifica UTF-8, remove BOM e cai para Windows-1252', () => {
    const utf8 = new TextEncoder().encode('﻿ação');
    expect(
      decodeText(
        utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.byteLength) as ArrayBuffer,
      ),
    ).toBe('ação');
    const latin1 = new Uint8Array([0x61, 0xe7, 0xe3, 0x6f]); // "açao" em Windows-1252
    expect(decodeText(latin1.buffer)).toBe('ação');
  });
  it('vazio → extraction_failed; normal → seções', async () => {
    expect(textToResult('  \n')).toEqual({ status: 'extraction_failed', reason: 'empty' });
    const r = await extractPlainText(new Blob(['linha um\n\nlinha dois']));
    expect(r).toMatchObject({ status: 'extracted', pageKind: 'section', pageCount: 1 });
  });
  it('roteia imagem para needs_ocr e tipo desconhecido para falha', async () => {
    expect((await extractFromBlob(new Blob(['x']), 'image/png')).status).toBe('needs_ocr');
    expect(await extractFromBlob(new Blob(['x']), 'application/zip')).toMatchObject({
      status: 'extraction_failed',
      reason: 'unsupported',
    });
  });
});

describe('batchPages', () => {
  const page = (n: number, len = 10) => ({ pageNumber: n, text: 'a'.repeat(len) });
  it('respeita o máximo de páginas por requisição', () => {
    const batches = batchPages(Array.from({ length: 25 }, (_, i) => page(i + 1)));
    expect(batches.map((b) => b.length)).toEqual([MAX_PAGES_PER_REQUEST, MAX_PAGES_PER_REQUEST, 5]);
  });
  it('respeita o máximo de caracteres e pula páginas vazias', () => {
    const big = Math.floor(MAX_CHARS_PER_REQUEST / 2) + 1;
    const batches = batchPages([page(1, big), page(2, 0), page(3, big)]);
    expect(batches.map((b) => b.map((p) => p.pageNumber))).toEqual([[1], [3]]);
  });
});

describe('guarda do OCR', () => {
  const desktop: DeviceInfo = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    maxTouchPoints: 0,
    coarsePointer: false,
  };
  it('bloqueia celulares e tablets', () => {
    expect(isDesktopDevice(desktop)).toBe(true);
    expect(
      isDesktopDevice({ ...desktop, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }),
    ).toBe(false);
    expect(isDesktopDevice({ ...desktop, userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe(
      false,
    );
    expect(isDesktopDevice({ ...desktop, uaDataMobile: true })).toBe(false);
    expect(
      isDesktopDevice({
        ...desktop,
        userAgent: 'Mozilla/5.0 (Macintosh)',
        maxTouchPoints: 5,
        coarsePointer: true,
      }),
    ).toBe(false);
  });
  it('imagem até 5 MB; acima disso é bloqueada', () => {
    expect(
      ocrBlockReason({ device: desktop, mime: 'image/png', sizeBytes: 5 * 1024 ** 2 }),
    ).toBeNull();
    expect(
      ocrBlockReason({ device: desktop, mime: 'image/png', sizeBytes: 5 * 1024 ** 2 + 1 }),
    ).toBe('image_too_large');
    expect(ocrBlockReason({ device: desktop, mime: 'text/plain', sizeBytes: 1 })).toBe(
      'unsupported',
    );
    expect(
      ocrBlockReason({
        device: { ...desktop, userAgent: 'iPhone' },
        mime: 'image/png',
        sizeBytes: 1,
      }),
    ).toBe('mobile');
    expect(
      ocrBlockReason({ device: desktop, mime: 'application/pdf', sizeBytes: 24 * 1024 ** 2 }),
    ).toBeNull();
  });
  it('janelas de no máximo 10 páginas por execução', () => {
    expect(ocrWindow(30)).toEqual({ from: 1, to: 10 });
    expect(ocrWindow(30, 11)).toEqual({ from: 11, to: 20 });
    expect(ocrWindow(25, 21)).toEqual({ from: 21, to: 25 });
    expect(ocrWindow(3)).toEqual({ from: 1, to: 3 });
  });
  it('lê o dispositivo atual sem lançar erro', () => {
    expect(typeof currentDevice().userAgent).toBe('string');
  });
});
