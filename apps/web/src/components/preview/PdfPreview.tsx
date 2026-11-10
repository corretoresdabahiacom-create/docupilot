import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '../../lib/pdf';
import { Banner, Button } from '../ui';

/** Pré-visualização de PDF no navegador (pdfjs). O arquivo vem por URL assinada de curta duração. */
export function PdfPreview({
  url,
  page,
  onPageChange,
}: {
  url: string;
  page: number;
  onPageChange: (n: number) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setPdf(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('download');
        loaded = await openPdf(await res.arrayBuffer());
        if (cancelled) await loaded.loadingTask.destroy();
        else setPdf(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [url]);

  const total = pdf?.numPages ?? 0;
  const current = Math.min(Math.max(1, page), Math.max(1, total));

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(current);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const width = canvas.parentElement?.clientWidth || base.width;
      const cssScale = Math.min(1.6, width / base.width);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = p.getViewport({ scale: cssScale * dpr });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvas, canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        /* renderização cancelada ao trocar de página */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, current]);

  if (failed) return <Banner tone="error">{t('preview.pdfFailed')}</Banner>;
  if (!pdf) return <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" disabled={current <= 1} onClick={() => onPageChange(current - 1)}>
          {t('preview.prev')}
        </Button>
        <span className="text-sm" aria-live="polite">
          {t('preview.pageOf', { n: current, total })}
        </span>
        <Button type="button" disabled={current >= total} onClick={() => onPageChange(current + 1)}>
          {t('preview.next')}
        </Button>
      </div>
      <div className="overflow-auto rounded-md border border-[var(--border)] bg-white">
        <canvas ref={canvasRef} aria-label={t('preview.pageOf', { n: current, total })} />
      </div>
    </div>
  );
}
