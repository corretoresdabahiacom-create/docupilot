import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ASSIGNABLE_ROLES,
  can,
  canAssignRole,
  canManageMember,
  isRole,
  type Role,
} from '@docupilot/shared';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { setActiveWorkspaceId, useActiveWorkspace } from '../lib/queries';
import { useActivity, useInvites, useMembers, type MemberRow } from '../lib/team';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
const MB = 1024 ** 2;

function ErrorBanner({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <Banner tone="error">{t(`errors.${code}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
  );
}

function CreateCompany() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ workspace: { id: string } }>('/organizations', { method: 'POST', body: { name } }),
    onSuccess: async (res) => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      setActiveWorkspaceId(res.workspace.id);
    },
    onError: (e) => setError(errorKey(e)),
  });
  return (
    <Card>
      <h2 className="font-semibold">{t('team.createCompany')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('team.createCompanyHint')}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field
          id="company-name"
          label={t('team.companyName')}
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending || name.trim() === ''}>
          {t('team.create')}
        </Button>
      </form>
      <ErrorBanner code={error} />
    </Card>
  );
}

function MemberItem({
  member,
  workspaceId,
  actorRole,
}: {
  member: MemberRow;
  workspaceId: string;
  actorRole: Role;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState(
    member.quotaBytes ? String(Math.round(member.quotaBytes / MB)) : '',
  );
  const role = isRole(member.role) ? member.role : 'viewer';
  const manageable = canManageMember(actorRole, role) && !member.isMe;
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', workspaceId] });

  const patch = useMutation({
    mutationFn: (body: { role?: string; quotaBytes?: number | null }) =>
      api(`/workspaces/${workspaceId}/members/${member.userId}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e) => setError(errorKey(e)),
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/workspaces/${workspaceId}/members/${member.userId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      if (member.isMe) {
        await qc.invalidateQueries({ queryKey: ['me'] });
      } else await refresh();
    },
    onError: (e) => setError(errorKey(e)),
  });

  return (
    <li className="flex flex-col gap-1 border-b border-[var(--border)] py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {member.displayName}
          {member.isMe && ` (${t('team.you')})`}
          {member.email && (
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">{member.email}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {manageable ? (
            <select
              aria-label={t('team.role')}
              value={member.role}
              onChange={(e) => patch.mutate({ role: e.target.value })}
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
            >
              {ASSIGNABLE_ROLES.filter((r) => canAssignRole(actorRole, r)).map((r) => (
                <option key={r} value={r}>
                  {t(`team.roles.${r}`)}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm">{t(`team.roles.${member.role}`)}</span>
          )}
          {manageable && (
            <button
              type="button"
              className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
              onClick={() => {
                if (window.confirm(t('team.confirmRemove', { name: member.displayName })))
                  remove.mutate();
              }}
            >
              {t('team.remove')}
            </button>
          )}
          {member.isMe && role !== 'owner' && (
            <button
              type="button"
              className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
              onClick={() => {
                if (window.confirm(t('team.confirmLeave'))) remove.mutate();
              }}
            >
              {t('team.leave')}
            </button>
          )}
        </span>
      </div>
      {member.usedBytes !== undefined && member.quotaBytes !== undefined && (
        <div className="flex flex-wrap items-end gap-2 text-xs text-[var(--muted)]">
          <span>
            {t('team.usage', {
              used: formatBytes(member.usedBytes),
              quota: formatBytes(member.quotaBytes),
            })}
            {member.quotaIsDefault && ` · ${t('team.defaultQuota')}`}
          </span>
          {manageable && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const mb = Number(quota);
                if (Number.isFinite(mb) && mb >= 0)
                  patch.mutate({ quotaBytes: Math.round(mb * MB) });
              }}
            >
              <Field
                id={`quota-${member.userId}`}
                label={t('team.quotaMb')}
                type="number"
                min={0}
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              />
              <Button type="submit" disabled={patch.isPending}>
                {t('common.save')}
              </Button>
              {!member.quotaIsDefault && (
                <Button
                  type="button"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ quotaBytes: null })}
                >
                  {t('team.resetQuota')}
                </Button>
              )}
            </form>
          )}
        </div>
      )}
      <ErrorBanner code={error} />
    </li>
  );
}

function InvitesCard({ workspaceId, actorRole }: { workspaceId: string; actorRole: Role }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const invites = useInvites(workspaceId, true);
  const [role, setRole] = useState<string>('viewer');
  const [hours, setHours] = useState('72');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = ASSIGNABLE_ROLES.filter((r) => canAssignRole(actorRole, r));

  const create = useMutation({
    mutationFn: () =>
      api<{ invite: { path: string } }>(`/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        body: { role, expiresInHours: Number(hours) },
      }),
    onSuccess: async (res) => {
      setError(null);
      setCopied(false);
      setLink(`${window.location.origin}${res.invite.path}`);
      await qc.invalidateQueries({ queryKey: ['invites', workspaceId] });
    },
    onError: (e) => setError(errorKey(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/workspaces/${workspaceId}/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', workspaceId] }),
    onError: (e) => setError(errorKey(e)),
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <h2 className="font-semibold">{t('team.invites')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('team.inviteHint')}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-role" className="text-sm font-medium">
            {t('team.role')}
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          >
            {allowed.map((r) => (
              <option key={r} value={r}>
                {t(`team.roles.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <Field
          id="invite-hours"
          label={t('team.expiresHours')}
          type="number"
          min={1}
          max={720}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          {t('team.createLink')}
        </Button>
      </form>
      <ErrorBanner code={error} />
      {link && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
          <p className="text-xs">{t('team.linkOnce')}</p>
          <input
            readOnly
            aria-label={t('team.link')}
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          />
          <div>
            <Button type="button" onClick={() => void copy()}>
              {copied ? t('team.copied') : t('team.copy')}
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-1">
        {(invites.data?.invites ?? []).map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-1 text-sm"
          >
            <span>
              {t(`team.roles.${i.role}`)} · {t(`team.inviteStatus.${i.status}`)}
              <span className="ml-2 text-xs text-[var(--muted)]">
                {formatDate(i.expiresAt, i18n.language)}
              </span>
            </span>
            {i.status === 'pending' && (
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
                onClick={() => revoke.mutate(i.id)}
              >
                {t('team.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityCard({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation();
  const activity = useActivity(workspaceId, true);
  return (
    <Card>
      <h2 className="font-semibold">{t('team.activity')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('team.activityHint')}</p>
      {activity.data?.events.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t('team.activityEmpty')}</p>
      )}
      <ul className="flex flex-col gap-1">
        {(activity.data?.events ?? []).map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              {e.displayName ?? t('team.system')} —{' '}
              {t(`team.actions.${e.action}`, { defaultValue: e.action })}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {formatDate(e.createdAt, i18n.language)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TeamPage() {
  const { t } = useTranslation();
  const workspace = useActiveWorkspace();
  const role: Role = isRole(workspace?.role) ? workspace.role : 'viewer';
  const company = workspace && !workspace.isPersonal ? workspace : undefined;
  const members = useMembers(company?.id);
  const manage = can(role, 'manage_members');
  const share = can(role, 'share');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('team.title')}</h1>
      {!company && <Banner>{t('team.personalNotice')}</Banner>}
      {company && (
        <>
          <p className="text-sm text-[var(--muted)]">
            {t('team.current', { name: company.name, role: t(`team.roles.${role}`) })}
          </p>
          <Card>
            <h2 className="font-semibold">
              {t('team.members')}
              {members.data && ` (${members.data.members.length}/${members.data.maxMembers})`}
            </h2>
            {members.isPending && <p className="text-sm">{t('common.loading')}</p>}
            <ul className="flex flex-col">
              {(members.data?.members ?? []).map((m) => (
                <MemberItem key={m.userId} member={m} workspaceId={company.id} actorRole={role} />
              ))}
            </ul>
          </Card>
          {manage && <InvitesCard workspaceId={company.id} actorRole={role} />}
          {share && <ActivityCard workspaceId={company.id} />}
        </>
      )}
      <CreateCompany />
    </div>
  );
}
