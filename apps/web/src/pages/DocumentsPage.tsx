import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../components/Turnstile';
import { Banner, Button, Card } from '../components/ui';
import { ApiError } from '../lib/api';
import { useDocuments, useHealth, useMe } from '../lib/queries';
import { uploadFile, type UploadStep } from '../lib/upload';

function UploadForm({ workspaceId, storageReady }: { workspaceId: string; storageReady: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<UploadStep | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>();
  const onToken = useCallback((v: string) => setToken(v), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    try {
      await uploadFile(workspaceId, file, setStep, token);
      setStep('done');
      if (fileRef.current) fileRef.current.value = '';
      await qc.invalidateQueries({ queryKey: ['documents', workspaceId] });
    } catch (err) {
      setStep(null);
      setError(err instanceof ApiError ? err.code : 'INTERNAL');
    }
  };

  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('upload.title')}</h2>
      {!storageReady && <Banner>{t('status.storageOff')}</Banner>}
      <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
        <label htmlFor="file" className="text-sm font-medium">
          {t('upload.choose')}
        </label>
        <input
          id="file"
          ref={fileRef}
          type="file"
          required
          disabled={!storageReady}
          accept=".pdf,.jpg,.jpeg,.png,.docx,.txt,.csv,.md"
          className="text-sm"
        />
        <p className="text-xs text-[var(--muted)]">{t('upload.allowed')}</p>
        <Turnstile onToken={onToken} />
        {step && step !== 'done' && (
          <Banner>
            {t(
              `upload.${step === 'hashing' ? 'hashing' : step === 'uploading' ? 'uploading' : 'validating'}`,
            )}
          </Banner>
        )}
        {step === 'done' && <Banner>{t('upload.done')}</Banner>}
        {error && (
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        )}
        <Button type="submit" disabled={!storageReady || (step !== null && step !== 'done')}>
          {t('upload.send')}
        </Button>
      </form>
    </Card>
  );
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const health = useHealth();
  const workspace = me.data?.workspaces[0];
  const docs = useDocuments(workspace?.id);
  const canEdit = workspace
    ? ['owner', 'admin', 'manager', 'editor'].includes(workspace.role)
    : false;

  return (
    <>
      {workspace && canEdit && (
        <UploadForm
          workspaceId={workspace.id}
          storageReady={health.data?.storage.configured === true}
        />
      )}
      <Card>
        <h1 className="mb-2 text-lg font-semibold">{t('documents.title')}</h1>
        {docs.data?.documents.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t('documents.empty')}</p>
        )}
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {docs.data?.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="break-all">{d.name}</span>
              <span className="text-xs text-[var(--muted)]">
                {t(`documents.status.${d.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
