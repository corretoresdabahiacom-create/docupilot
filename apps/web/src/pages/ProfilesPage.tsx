import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  CANON_KEYS,
  normalizeProfileFields,
  PROFILE_LABEL_MAX,
  type CanonKey,
} from '@docupilot/shared';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError, type ProfileData } from '../lib/api';
import { saveBlob } from '../lib/fill';
import { formatDate } from '../lib/format';
import { useHealth, usePiiConsent, usePiiConsentMutation, useProfiles } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
type Values = Partial<Record<CanonKey, string>>;

function ProfileForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: { id: string | null; label: string; values: Values };
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(initial.label);
  const [values, setValues] = useState<Values>(initial.values);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const norm = normalizeProfileFields(values);
    if (!norm.ok) {
      setError(
        norm.empty
          ? t('profiles.none')
          : t('profiles.invalid', {
              fields: norm.invalid.map((k) => t(`profiles.fields.${k}`)).join(', '),
            }),
      );
      return;
    }
    setBusy(true);
    try {
      await api(initial.id ? `/me/profiles/${initial.id}` : '/me/profiles', {
        method: initial.id ? 'PUT' : 'POST',
        body: { label, fields: values },
      });
      onDone();
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      <Field
        id="profile-label"
        label={t('profiles.label')}
        value={label}
        maxLength={PROFILE_LABEL_MAX}
        onChange={(e) => setLabel(e.target.value)}
        required
      />
      <p className="text-xs text-[var(--muted)]">{t('profiles.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {CANON_KEYS.map((k) => (
          <Field
            key={k}
            id={`profile-${k}`}
            label={t(`profiles.fields.${k}`)}
            value={values[k] ?? ''}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
          />
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || label.trim() === ''}>
          {t('profiles.save')}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          className="!bg-transparent !text-[var(--text)] border border-[var(--border)]"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ProfilesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const health = useHealth();
  const consent = usePiiConsent();
  const consentMutation = usePiiConsentMutation();
  const profiles = useProfiles();
  const [form, setForm] = useState<{ id: string | null; label: string; values: Values } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const piiOff = health.data ? !health.data.pii.configured : false;
  const hasConsent = consent.data === true;
  const list = profiles.data?.profiles ?? [];
  const max = profiles.data?.max ?? 10;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['profiles'] });

  const edit = (id: string) =>
    run(async () => {
      const p = await api<ProfileData>(`/me/profiles/${id}`);
      setForm({ id, label: p.label, values: p.fields });
    });

  const exportProfile = (id: string, label: string) =>
    run(async () => {
      if (!window.confirm(t('profiles.exportConfirm'))) return;
      const data = await api<ProfileData>(`/me/profiles/${id}/export`, {
        method: 'POST',
        body: { confirm: true },
      });
      saveBlob(
        JSON.stringify(data, null, 2),
        `perfil-${label.replace(/[^\w-]+/g, '_')}.json`,
        'application/json',
      );
    });

  const remove = (id: string, label: string) =>
    run(async () => {
      if (!window.confirm(t('profiles.deleteConfirm', { name: label }))) return;
      await api(`/me/profiles/${id}`, { method: 'DELETE', body: { confirm: true } });
      setMessage(t('profiles.deleted'));
      await refresh();
    });

  return (
    <>
      <Link to="/" className="min-h-11 content-center text-sm underline">
        ← {t('profiles.back')}
      </Link>
      <h1 className="text-xl font-semibold">{t('profiles.title')}</h1>
      <p className="text-sm text-[var(--muted)]">{t('profiles.intro')}</p>

      {piiOff && <Banner tone="error">{t('profiles.unavailable')}</Banner>}

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('profiles.consentTitle')}</h2>
        <p className="mb-3 text-sm">{t('profiles.consentText')}</p>
        {hasConsent ? (
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-sm font-medium">
              ✓ {t('profiles.consentGranted')}
            </span>
            <Button
              type="button"
              danger
              disabled={consentMutation.isPending}
              onClick={() => consentMutation.mutate(false)}
            >
              {t('profiles.consentRevoke')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            disabled={consentMutation.isPending || piiOff}
            onClick={() => consentMutation.mutate(true)}
          >
            {t('profiles.consentGrant')}
          </Button>
        )}
        {!hasConsent && list.length > 0 && (
          <p className="mt-2 text-xs text-[var(--muted)]">{t('profiles.revokedNote')}</p>
        )}
      </Card>

      {message && <Banner>{message}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {form ? (
        <Card>
          <ProfileForm
            key={form.id ?? 'new'}
            initial={form}
            onCancel={() => setForm(null)}
            onDone={() => {
              setForm(null);
              setMessage(t('profiles.saved'));
              void refresh();
            }}
          />
        </Card>
      ) : (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('profiles.list')}</h2>
            <Button
              type="button"
              disabled={!hasConsent || piiOff || list.length >= max}
              onClick={() => setForm({ id: null, label: '', values: {} })}
            >
              {t('profiles.new')}
            </Button>
          </div>
          <p className="mb-2 text-xs text-[var(--muted)]">{t('profiles.limit', { max })}</p>
          {list.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t('profiles.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium break-all">{p.label}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {t('profiles.updated', { date: formatDate(p.updatedAt, i18n.language) })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={!hasConsent} onClick={() => void edit(p.id)}>
                      {t('profiles.edit')}
                    </Button>
                    <Button type="button" onClick={() => void exportProfile(p.id, p.label)}>
                      {t('profiles.export')}
                    </Button>
                    <Button type="button" danger onClick={() => void remove(p.id, p.label)}>
                      {t('profiles.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
