import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OCR_MAX_IMAGE_BYTES, OCR_MAX_PAGES_PER_RUN } from '@docupilot/shared';
import { ApiError } from '../lib/api';
import { fetchDocumentBlob } from '../lib/documents';
import { currentDevice, ocrBlockReason, runOcr, type OcrProgress } from '../lib/extract/ocr';
import { submitExtraction } from '../lib/extract/submit';
import { useGrantOcrConsent, useOcrConsent, useRevokeOcrConsent } from '../lib/queries';
import { Banner, Button } from './ui';

/**
 * OCR no navegador (experimental, opt-in). O documento não sai do computador; o consentimento
 * é registrado no servidor e exigido por ele para aceitar texto vindo de OCR.
 */
export function OcrPanel({
  workspaceId,
  documentId,
  versionId,
  mime,
  sizeBytes,
  startFrom = 1,
}: {
  workspaceId: string;
  documentId: string;
  versionId: string;
  mime: string;
  sizeBytes: number;
  startFrom?: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const consent = useOcrConsent();
  const grant = useGrantOcrConsent();
  const revoke = useRevokeOcrConsent();
  const [agree, setAgree] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [from, setFrom] = useState(startFrom);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const block = ocrBlockReason({ device: currentDevice(), mime, sizeBytes });
  const hasConsent = consent.data === true;

  const run = async () => {
    setError(null);
    setMessage(null);
    setRunning(true);
    try {
      if (!hasConsent) await grant.mutateAsync();
      const blob = await fetchDocumentBlob(workspaceId, documentId, versionId);
      const out = await runOcr({ blob, mime, from, onProgress: setProgress });
      if (out.result.status !== 'extracted' && from > 1) {
        // Continuação sem texto novo: não envia nada, para não apagar o OCR já salvo.
        setMessage(t('ocr.noNewText'));
      } else {
        await submitExtraction({ workspaceId, documentId, versionId }, out.result, 'client_ocr');
        await qc.invalidateQueries();
        setMessage(out.result.status === 'extracted' ? t('ocr.done') : t('ocr.empty'));
      }
      setFrom(out.nextFrom ?? 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'OCR_FAILED');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3">
      <h3 className="font-semibold">{t('ocr.title')}</h3>
      <p className="text-sm">{t('ocr.explain')}</p>
      <ul className="list-disc pl-5 text-xs text-[var(--muted)]">
        <li>{t('ocr.limitDesktop')}</li>
        <li>{t('ocr.limitPages', { n: OCR_MAX_PAGES_PER_RUN })}</li>
        <li>{t('ocr.limitImage', { mb: OCR_MAX_IMAGE_BYTES / 1024 ** 2 })}</li>
        <li>{t('ocr.limitCdn')}</li>
      </ul>

      {block ? (
        <Banner>{t(`ocr.block.${block}`, { mb: OCR_MAX_IMAGE_BYTES / 1024 ** 2 })}</Banner>
      ) : (
        <>
          {!hasConsent && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              <span>{t('ocr.consent')}</span>
            </label>
          )}
          <Button
            type="button"
            disabled={running || (!hasConsent && !agree)}
            onClick={() => void run()}
          >
            {running
              ? t('ocr.running')
              : from > 1
                ? t('ocr.continue', { n: from })
                : t('ocr.start')}
          </Button>
          {progress && (
            <Banner>
              {t('ocr.progress', {
                page: progress.page,
                done: progress.done,
                total: progress.total,
              })}
            </Banner>
          )}
          {hasConsent && (
            <button
              type="button"
              className="self-start text-xs underline"
              onClick={() => void revoke.mutateAsync()}
            >
              {t('ocr.revoke')}
            </button>
          )}
        </>
      )}
      {message && <Banner>{message}</Banner>}
      {error && (
        <Banner tone="error">
          {t(`errors.${error}`, { defaultValue: t('errors.OCR_FAILED') })}
        </Banner>
      )}
    </div>
  );
}
