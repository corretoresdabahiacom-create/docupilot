import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../lib/api';
import {
  precheckUpload,
  uploadFile,
  type Precheck,
  type UploadedDocument,
  type UploadStep,
} from '../lib/upload';
import { Turnstile } from './Turnstile';
import { Banner, Button, Card } from './ui';

type Pending = { file: File; pre: Precheck; kind: 'duplicate' | 'sameName' };

/**
 * Envio de arquivo. Sem `documentId` cria um documento; com `documentId` cria uma nova versão.
 * Antes de enviar, avisa de arquivo idêntico (mesmo SHA-256) e de documento com o mesmo nome.
 */
export function UploadForm({
  workspaceId,
  folderId,
  documentId,
  storageReady,
  onUploaded,
}: {
  workspaceId: string;
  folderId?: string | null;
  documentId?: string;
  storageReady: boolean;
  onUploaded?: (doc: UploadedDocument) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<UploadStep | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [token, setToken] = useState<string | undefined>();
  const onToken = useCallback((v: string) => setToken(v), []);
  const busy = step !== null && step !== 'done';

  const send = async (
    file: File,
    extra: { sha256?: string; allowDuplicate?: boolean; asVersionOf?: string },
  ) => {
    setPending(null);
    setError(null);
    try {
      const uploaded = await uploadFile(workspaceId, file, {
        folderId,
        documentId: extra.asVersionOf ?? documentId,
        sha256: extra.sha256,
        allowDuplicate: extra.allowDuplicate,
        turnstileToken: token,
        onStep: setStep,
      });
      setStep('done');
      if (fileRef.current) fileRef.current.value = '';
      await qc.invalidateQueries();
      onUploaded?.(uploaded);
    } catch (err) {
      setStep(null);
      if (err instanceof ApiError && err.code === 'DUPLICATE_FILE' && err.details) {
        setError('DUPLICATE_FILE');
        return;
      }
      setError(err instanceof ApiError ? err.code : 'INTERNAL');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setStep('hashing');
    try {
      const pre = await precheckUpload(workspaceId, file, folderId ?? null);
      if (pre.duplicate) {
        setStep(null);
        setPending({ file, pre, kind: 'duplicate' });
        return;
      }
      if (pre.sameName && !documentId) {
        setStep(null);
        setPending({ file, pre, kind: 'sameName' });
        return;
      }
      await send(file, { sha256: pre.sha256 });
    } catch (err) {
      setStep(null);
      setError(err instanceof ApiError ? err.code : 'INTERNAL');
    }
  };

  const stepLabel = step && step !== 'done' ? t(`upload.step.${step}`) : null;

  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">
        {documentId ? t('upload.newVersionTitle') : t('upload.title')}
      </h2>
      {!storageReady && <Banner>{t('status.storageOff')}</Banner>}
      <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
        <label htmlFor={`file-${documentId ?? 'new'}`} className="text-sm font-medium">
          {t('upload.choose')}
        </label>
        <input
          id={`file-${documentId ?? 'new'}`}
          ref={fileRef}
          type="file"
          required
          disabled={!storageReady || busy}
          accept=".pdf,.jpg,.jpeg,.png,.docx,.txt,.csv,.md"
          className="text-sm"
        />
        <p className="text-xs text-[var(--muted)]">{t('upload.allowed')}</p>
        <Turnstile onToken={onToken} />

        {pending && (
          <div
            className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3"
            role="alert"
          >
            <p className="text-sm">
              {pending.kind === 'duplicate'
                ? t('upload.duplicate', { name: pending.pre.duplicate?.name })
                : t('upload.sameName', { name: pending.pre.sameName?.name })}
            </p>
            <div className="flex flex-wrap gap-2">
              {pending.kind === 'duplicate' && pending.pre.duplicate && (
                <Link
                  className="min-h-11 content-center rounded-md border border-[var(--border)] px-4 text-sm"
                  to={`/documents/${pending.pre.duplicate.documentId}`}
                >
                  {t('upload.openExisting')}
                </Link>
              )}
              {pending.kind === 'sameName' && pending.pre.sameName && (
                <Button
                  type="button"
                  onClick={() =>
                    void send(pending.file, {
                      sha256: pending.pre.sha256,
                      asVersionOf: pending.pre.sameName!.documentId,
                    })
                  }
                >
                  {t('upload.asNewVersion')}
                </Button>
              )}
              <Button
                type="button"
                onClick={() =>
                  void send(pending.file, { sha256: pending.pre.sha256, allowDuplicate: true })
                }
              >
                {pending.kind === 'duplicate' ? t('upload.sendAnyway') : t('upload.asNewDocument')}
              </Button>
              <Button type="button" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {stepLabel && <Banner>{stepLabel}</Banner>}
        {step === 'done' && <Banner>{t('upload.done')}</Banner>}
        {error && (
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        )}
        <Button type="submit" disabled={!storageReady || busy}>
          {t('upload.send')}
        </Button>
      </form>
    </Card>
  );
}
