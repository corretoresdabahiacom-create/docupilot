import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, Field } from '../components/ui';
import {
  useAdminFlags,
  useAdminOverview,
  useAdminQuotas,
  useAdminReports,
  useAdminUsers,
  type AdminReport,
} from '../lib/admin';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';

const errKey = (e: unknown) => (e instanceof ApiError ? e.code : 'INTERNAL');
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

function useAdminAction<T = unknown>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => setError(errKey(e)),
  });
  return { m, error };
}

function ErrorLine({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <Banner tone="error">{t(`errors.${code}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
  );
}

function Overview() {
  const { t } = useTranslation();
  const o = useAdminOverview().data;
  if (!o) return null;
  const rows: [string, string | number][] = [
    [t('admin.activeUsers'), o.totals.activeUsers],
    [t('admin.suspendedUsers'), o.totals.suspendedUsers],
    [t('admin.organizations'), o.totals.organizations],
    [t('admin.workspaces'), o.totals.workspaces],
    [t('admin.documents'), o.totals.documents],
    [t('admin.storageApp'), formatBytes(o.consumption.storageBytes)],
    [t('admin.stuckJobs'), (o.jobs.stuckExecutions ?? 0) + (o.jobs.stuckExtractions ?? 0)],
    [t('admin.failedExecutions'), o.failures.failedExecutions7d ?? 0],
    [t('admin.openReports'), o.reports.open + o.reports.ownerNotified],
  ];
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('admin.overview')}</h2>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-[var(--border)] py-1">
            <dt>{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-col gap-2">
        <Banner>{t('admin.notMeasured')}</Banner>
        {!o.consumption.database.nominalVerified && <Banner>{t('admin.dbUnverified')}</Banner>}
        {!o.shares.featureImplemented && <Banner>{t('admin.sharesNotImplemented')}</Banner>}
        <Banner>{t('admin.noContent')}</Banner>
      </div>
    </Card>
  );
}

function Users() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const users = useAdminUsers(q);
  const { m, error } = useAdminAction<{ id: string; status: 'active' | 'suspended' }>((v) =>
    api(`/admin/users/${v.id}`, { method: 'PATCH', body: { status: v.status } }),
  );
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('admin.users')}</h2>
      <Field
        id="admin-user-q"
        type="search"
        label={t('admin.searchEmail')}
        value={q}
        maxLength={100}
        onChange={(e) => setQ(e.target.value)}
      />
      <ErrorLine code={error} />
      <ul className="mt-2 flex flex-col divide-y divide-[var(--border)]">
        {users.data?.users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-all text-sm">
              {u.email}
              <span className="ml-2 text-xs text-[var(--muted)]">
                {u.isPlatformAdmin ? `${t('admin.platformAdmin')} · ` : ''}
                {t(`admin.status.${u.status === 'active' ? 'active' : 'suspended'}`)}
              </span>
            </span>
            {!u.isPlatformAdmin && (
              <Button
                type="button"
                danger={u.status === 'active'}
                disabled={m.isPending}
                onClick={() => {
                  const next = u.status === 'active' ? 'suspended' : 'active';
                  if (
                    next === 'active' ||
                    window.confirm(t('admin.confirmSuspend', { email: u.email }))
                  )
                    m.mutate({ id: u.id, status: next });
                }}
              >
                {u.status === 'active' ? t('admin.suspend') : t('admin.reactivate')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportItem({ r, graceHours }: { r: AdminReport; graceHours: number }) {
  const { t } = useTranslation();
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState('');
  const notify = useAdminAction(() =>
    api(`/admin/reports/${r.id}/notify-owner`, { method: 'POST' }),
  );
  const dismiss = useAdminAction(() => api(`/admin/reports/${r.id}/dismiss`, { method: 'POST' }));
  const remove = useAdminAction(() =>
    api(`/admin/reports/${r.id}/remove`, {
      method: 'POST',
      body: urgent ? { urgent: true, urgentReason } : { urgent: false },
    }),
  );
  const error = notify.error ?? dismiss.error ?? remove.error;
  const resolved = r.status === 'dismissed' || r.status === 'removed';
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div>
        <span className="font-medium">{t(`report.types.${r.targetType}`)}</span>
        <span className="ml-2 break-all text-xs text-[var(--muted)]">{r.targetRef}</span>
      </div>
      <p className="break-words">{r.reason}</p>
      <p className="text-xs text-[var(--muted)]">
        {t(`admin.reportStatus.${r.status}`)} · {when(r.createdAt)}
        {r.removalAfter ? ` · ${t('admin.removalAfter', { date: when(r.removalAfter) })}` : ''}
      </p>
      {!resolved && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {r.status === 'open' && r.targetType === 'document' && (
              <Button
                type="button"
                disabled={notify.m.isPending}
                onClick={() => notify.m.mutate(undefined)}
              >
                {t('admin.notifyOwner', { hours: graceHours })}
              </Button>
            )}
            <Button
              type="button"
              disabled={dismiss.m.isPending}
              onClick={() => dismiss.m.mutate(undefined)}
            >
              {t('admin.dismiss')}
            </Button>
          </div>
          {r.targetType === 'document' && (
            <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-2">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                />
                {t('admin.urgent')}
              </label>
              {urgent && (
                <Field
                  id={`urgent-${r.id}`}
                  label={t('admin.urgentReason')}
                  value={urgentReason}
                  maxLength={500}
                  onChange={(e) => setUrgentReason(e.target.value)}
                />
              )}
              <Button
                type="button"
                danger
                disabled={remove.m.isPending || (urgent && urgentReason.trim().length < 10)}
                onClick={() => {
                  if (window.confirm(t('admin.confirmRemove'))) remove.m.mutate(undefined);
                }}
              >
                {t('admin.removeContent')}
              </Button>
            </div>
          )}
        </div>
      )}
      <ErrorLine code={error} />
    </li>
  );
}

function Reports() {
  const { t } = useTranslation();
  const reports = useAdminReports();
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('admin.reports')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('admin.reportsHelp')}</p>
      {reports.data?.reports.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t('admin.noReports')}</p>
      )}
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {reports.data?.reports.map((r) => (
          <ReportItem key={r.id} r={r} graceHours={reports.data.graceHours} />
        ))}
      </ul>
    </Card>
  );
}

function Flags() {
  const { t } = useTranslation();
  const flags = useAdminFlags();
  const { m, error } = useAdminAction<string>((key) =>
    api(`/admin/flags/${key}`, { method: 'PUT', body: { enabled: false } }),
  );
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('admin.flags')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('admin.flagsHelp')}</p>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {flags.data?.flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              {f.key} · {f.enabled ? t('admin.on') : t('admin.off')}
            </span>
            {f.enabled && (
              <Button type="button" disabled={m.isPending} onClick={() => m.mutate(f.key)}>
                {t('admin.turnOff')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine code={error} />
    </Card>
  );
}

function Quotas() {
  const { t } = useTranslation();
  const quotas = useAdminQuotas().data;
  const [edit, setEdit] = useState<Record<string, string>>({});
  const save = useAdminAction<{ name: string; value: number }>((v) =>
    api(`/admin/quotas/${v.name}`, { method: 'PUT', body: { value: v.value } }),
  );
  const reset = useAdminAction<string>((name) =>
    api(`/admin/quotas/${name}`, { method: 'DELETE' }),
  );
  if (!quotas) return null;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('admin.quotas')}</h2>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {Object.keys(quotas.defaults).map((name) => (
          <li key={name} className="flex flex-wrap items-end gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <Field
                id={`quota-${name}`}
                type="number"
                min={0}
                label={`${name} (${t('admin.default')}: ${quotas.defaults[name]})`}
                value={edit[name] ?? String(quotas.effective[name])}
                onChange={(e) => setEdit({ ...edit, [name]: e.target.value })}
              />
            </div>
            <Button
              type="button"
              disabled={save.m.isPending || edit[name] === undefined}
              onClick={() => save.m.mutate({ name, value: Number(edit[name]) })}
            >
              {t('common.save')}
            </Button>
            {name in quotas.overrides && (
              <Button type="button" onClick={() => reset.m.mutate(name)}>
                {t('admin.resetQuota')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine code={save.error ?? reset.error} />
    </Card>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="text-xl font-semibold">{t('admin.title')}</h1>
      <Overview />
      <Reports />
      <Users />
      <Flags />
      <Quotas />
    </>
  );
}
