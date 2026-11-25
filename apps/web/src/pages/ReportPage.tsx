import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../components/Turnstile';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';

/** Denúncia pública: não exige login e a resposta nunca revela se o conteúdo existe. */
export function ReportPage() {
  const { t } = useTranslation();
  const [targetType, setTargetType] = useState<'document' | 'shared_link' | 'other'>('shared_link');
  const [targetRef, setTargetRef] = useState('');
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<string>();
  const send = useMutation({
    mutationFn: () =>
      api('/reports', {
        method: 'POST',
        body: { targetType, targetRef, reason, turnstileToken: token },
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };
  const errCode = send.error instanceof ApiError ? send.error.code : 'INTERNAL';

  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">{t('report.title')}</h1>
      <p className="mb-3 text-sm text-[var(--muted)]">{t('report.intro')}</p>
      {send.isSuccess ? (
        <Banner>{t('report.sent')}</Banner>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="report-type" className="text-sm font-medium">
              {t('report.type')}
            </label>
            <select
              id="report-type"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as typeof targetType)}
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-base"
            >
              <option value="shared_link">{t('report.types.shared_link')}</option>
              <option value="document">{t('report.types.document')}</option>
              <option value="other">{t('report.types.other')}</option>
            </select>
          </div>
          <Field
            id="report-ref"
            label={t('report.ref')}
            hint={t('report.refHint')}
            value={targetRef}
            maxLength={300}
            required
            onChange={(e) => setTargetRef(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="report-reason" className="text-sm font-medium">
              {t('report.reason')}
            </label>
            <textarea
              id="report-reason"
              value={reason}
              minLength={10}
              maxLength={2000}
              required
              rows={5}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-base"
            />
          </div>
          <Turnstile onToken={setToken} />
          {send.isError && (
            <Banner tone="error">
              {t(`errors.${errCode}`, { defaultValue: t('errors.INTERNAL') })}
            </Banner>
          )}
          <Button type="submit" disabled={send.isPending}>
            {t('report.submit')}
          </Button>
          <p className="text-xs text-[var(--muted)]">{t('report.privacy')}</p>
        </form>
      )}
    </Card>
  );
}
