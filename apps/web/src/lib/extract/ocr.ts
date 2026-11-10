import {
  detectTextGarbage,
  OCR_MAX_IMAGE_BYTES,
  OCR_MAX_PAGES_PER_RUN,
  sanitizeText,
} from '@docupilot/shared';
import { openPdf } from '../pdf';
import type { ExtractedPage, ExtractionResult } from './types';

/** OCR no navegador é experimental: só em desktop, com limites que protegem memória e bateria. */
export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
  uaDataMobile?: boolean;
}

export function currentDevice(): DeviceInfo {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    coarsePointer:
      typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
    uaDataMobile: nav.userAgentData?.mobile,
  };
}

export function isDesktopDevice(d: DeviceInfo): boolean {
  if (d.uaDataMobile === true) return false;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(d.userAgent)) return false;
  // iPadOS se apresenta como Mac, mas tem tela de toque e ponteiro "grosso".
  if (d.maxTouchPoints > 1 && d.coarsePointer) return false;
  return true;
}

export type OcrBlock = 'mobile' | 'image_too_large' | 'unsupported';

export function ocrBlockReason(input: {
  device: DeviceInfo;
  mime: string;
  sizeBytes: number;
}): OcrBlock | null {
  if (!isDesktopDevice(input.device)) return 'mobile';
  const isImage = input.mime === 'image/jpeg' || input.mime === 'image/png';
  if (input.mime !== 'application/pdf' && !isImage) return 'unsupported';
  if (isImage && input.sizeBytes > OCR_MAX_IMAGE_BYTES) return 'image_too_large';
  return null;
}

/** Janela de páginas de uma execução (no máximo 10). `from` começa em 1. */
export function ocrWindow(totalPages: number, from = 1): { from: number; to: number } {
  const start = Math.max(1, from);
  return { from: start, to: Math.min(totalPages, start + OCR_MAX_PAGES_PER_RUN - 1) };
}

export interface OcrProgress {
  page: number;
  done: number;
  total: number;
}

export interface OcrRun {
  result: ExtractionResult;
  /** Primeira página ainda não reconhecida, ou null se terminou. */
  nextFrom: number | null;
  totalPages: number;
}

const MAX_CANVAS_SIDE = 3000;

/**
 * Reconhece o texto no navegador com tesseract.js. O documento não sai do computador; o motor
 * (worker + WASM) e os dados de idioma são baixados de um CDN público (jsDelivr), a menos que as
 * variáveis VITE_OCR_*_PATH apontem para uma cópia própria.
 */
export async function runOcr(opts: {
  blob: Blob;
  mime: string;
  from?: number;
  onProgress?: (p: OcrProgress) => void;
}): Promise<OcrRun> {
  const { createWorker } = await import('tesseract.js');
  // Por padrão o tesseract.js baixa o worker, o núcleo WASM e os idiomas do jsDelivr. Cada
  // origem pode apontar para uma cópia própria (ver docs/env-vars.md).
  const env = import.meta.env;
  const paths: Record<string, string> = {};
  if (env.VITE_OCR_WORKER_PATH) paths.workerPath = env.VITE_OCR_WORKER_PATH as string;
  if (env.VITE_OCR_CORE_PATH) paths.corePath = env.VITE_OCR_CORE_PATH as string;
  if (env.VITE_OCR_LANG_PATH) paths.langPath = env.VITE_OCR_LANG_PATH as string;
  const worker = await createWorker(['por', 'eng'], 1, paths);
  const pages: ExtractedPage[] = [];
  let totalPages = 1;
  let nextFrom: number | null = null;
  try {
    if (opts.mime === 'application/pdf') {
      const pdf = await openPdf(await opts.blob.arrayBuffer());
      try {
        totalPages = pdf.numPages;
        const win = ocrWindow(totalPages, opts.from);
        const count = win.to - win.from + 1;
        for (let n = win.from; n <= win.to; n++) {
          opts.onProgress?.({ page: n, done: n - win.from, total: count });
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('canvas');
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          const { data } = await worker.recognize(canvas);
          pages.push({ pageNumber: n, text: sanitizeText(data.text).trim() });
          page.cleanup();
          canvas.width = canvas.height = 0;
        }
        nextFrom = win.to < totalPages ? win.to + 1 : null;
        opts.onProgress?.({ page: win.to, done: count, total: count });
      } finally {
        await pdf.loadingTask.destroy();
      }
    } else {
      opts.onProgress?.({ page: 1, done: 0, total: 1 });
      const { data } = await worker.recognize(opts.blob);
      pages.push({ pageNumber: 1, text: sanitizeText(data.text).trim() });
      opts.onProgress?.({ page: 1, done: 1, total: 1 });
    }
  } finally {
    await worker.terminate();
  }

  const joined = pages.map((p) => p.text).join('\n');
  const verdict = detectTextGarbage(joined);
  if (verdict.reason === 'empty' || verdict.reason === 'too_short') {
    return {
      result: { status: 'extraction_failed', reason: 'empty', pageCount: totalPages },
      nextFrom,
      totalPages,
    };
  }
  return {
    result: {
      status: 'extracted',
      pageKind: 'page',
      pageCount: totalPages,
      pages: pages.filter((p) => p.text.length > 0),
    },
    nextFrom,
    totalPages,
  };
}
