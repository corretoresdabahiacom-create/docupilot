import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { useFolderAccess, useMembers } from '../lib/team';
import { Banner, Button } from './ui';

/** Compartilhamento de pasta: restringir e conceder leitura/edição a membros (Fase 7). */
export function FolderAccessPanel({
  workspaceId,
  folderId,
  onChanged,
}: {
  workspaceId: string;
  folderId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const access = useFolderAccess(workspaceId, folderId);
  const members = useMembers(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const [level, setLevel] = useState<'view' | 'edit'>('view');

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['folderAccess', workspaceId, folderId] });
    await qc.invalidateQueries({ queryKey: ['folders', workspaceId] });
    await qc.invalidateQueries({ queryKey: ['documents', workspaceId] });
    onChanged();
  };
  const run = useMutation({
    mutationFn: (req: { path: string; method: string; body?: unknown }) =>
      api(`/workspaces/${workspaceId}/folders/${folderId}/access${req.path}`, {
        method: req.method,
        body: req.body,
      }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.code : 'INTERNAL'),
  });

  if (access.isPending) return <p className="text-sm">{t('common.loading')}</p>;
  if (!access.data) return null;
  const { restricted, grants } = access.data;
  const granted = new Set(grants.map((g) => g.userId));
  // Quem já vê tudo (owner/admin/manager) não precisa de concessão.
  const candidates = (members.data?.members ?? []).filter(
    (m) => !granted.has(m.userId) && !['owner', 'admin', 'manager'].includes(m.role),
  );

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-md border border-[var(--border)] p-3">
      {error && (
        <Banner tone="error">{t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={restricted}
          disabled={run.isPending}
          onChange={(e) =>
            run.mutate({ path: '', method: 'PUT', body: { restricted: e.target.checked } })
          }
        />
        {t('folderAccess.restrict')}
      </label>
      <p className="text-xs text-[var(--muted)]">
        {restricted ? t('folderAccess.restrictedHint') : t('folderAccess.openHint')}
      </p>
      {restricted && (
        <>
          <ul className="flex flex-col gap-1">
            {grants.length === 0 && (
              <li className="text-sm text-[var(--muted)]">{t('folderAccess.noGrants')}</li>
            )}
            {grants.map((g) => (
              <li key={g.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{g.displayName}</span>
                <span className="flex items-center gap-2">
                  <select
                    aria-label={t('folderAccess.level')}
                    value={g.access}
                    onChange={(e) =>
                      run.mutate({
                        path: `/${g.userId}`,
                        method: 'PUT',
                        body: { access: e.target.value },
                      })
                    }
                    className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                  >
                    <option value="view">{t('folderAccess.view')}</option>
                    <option value="edit">{t('folderAccess.edit')}</option>
                  </select>
                  <button
                    type="button"
                    className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
                    onClick={() => run.mutate({ path: `/${g.userId}`, method: 'DELETE' })}
                  >
                    {t('folderAccess.revoke')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (who) run.mutate({ path: `/${who}`, method: 'PUT', body: { access: level } });
                setWho('');
              }}
            >
              <select
                aria-label={t('folderAccess.member')}
                value={who}
                onChange={(e) => setWho(e.target.value)}
                className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              >
                <option value="">{t('folderAccess.member')}</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('folderAccess.level')}
                value={level}
                onChange={(e) => setLevel(e.target.value as 'view' | 'edit')}
                className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              >
                <option value="view">{t('folderAccess.view')}</option>
                <option value="edit">{t('folderAccess.edit')}</option>
              </select>
              <Button type="submit" disabled={!who || run.isPending}>
                {t('folderAccess.grant')}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
