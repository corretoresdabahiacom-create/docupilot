import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Card } from '../components/ui';
import { api } from '../lib/api';
import { useNotifications } from '../lib/creation';
import { formatDate } from '../lib/format';

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const q = useNotifications();
  const qc = useQueryClient();
  const markAll = async () => {
    await api('/me/notifications/read', { method: 'POST', body: {} });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const items = q.data?.notifications ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('notifications.title')}</h1>
      <p className="text-xs text-[var(--muted)]">{t('notifications.inAppOnly')}</p>
      {(q.data?.unread ?? 0) > 0 && (
        <div>
          <Button type="button" onClick={() => void markAll()}>
            {t('notifications.markAll')}
          </Button>
        </div>
      )}
      <Card>
        {q.isPending && <p className="text-sm">{t('common.loading')}</p>}
        {q.data && items.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t('notifications.empty')}</p>
        )}
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2"
            >
              <span className={n.readAt ? 'text-sm' : 'text-sm font-semibold'}>
                {t(`notifications.kinds.${n.kind}`, {
                  defaultValue: n.kind,
                  name: n.data?.workflowName ?? '',
                })}
              </span>
              <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
                {formatDate(n.createdAt, i18n.language)}
                {n.data?.executionId && (
                  <Link to={`/workflows/executions/${n.data.executionId}`} className="underline">
                    {t('notifications.open')}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
