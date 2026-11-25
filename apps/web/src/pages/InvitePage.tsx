import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { Banner, Button, Card } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { clearPendingInvite, rememberInvite } from '../lib/team';
import { setActiveWorkspaceId } from '../lib/queries';

interface Preview {
  invite: { organizationName: string; workspaceName: string; role: string; expiresAt: number };
}

/** Página do link de convite: prévia pública e aceite (exige login; o link fica guardado até lá). */
export function InvitePage({ signedIn }: { signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<Preview>(`/invites/${encodeURIComponent(token)}`),
    retry: false,
  });

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ workspace: { id: string } }>('/invites/accept', {
        method: 'POST',
        body: { token },
      });
      clearPendingInvite();
      await qc.invalidateQueries({ queryKey: ['me'] });
      setActiveWorkspaceId(res.workspace.id);
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'INTERNAL');
    } finally {
      setBusy(false);
    }
  };

  if (preview.isPending) return <p className="text-sm">{t('common.loading')}</p>;
  if (preview.isError) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">{t('invite.title')}</h1>
        <p className="mt-2 text-sm">{t('invite.invalid')}</p>
        <Link to="/" className="mt-2 inline-block text-sm underline">
          {t('invite.home')}
        </Link>
      </Card>
    );
  }
  const inv = preview.data.invite;
  return (
    <Card>
      <h1 className="text-xl font-semibold">{t('invite.title')}</h1>
      <p className="mt-2 text-sm">
        {t('invite.summary', {
          org: inv.organizationName,
          workspace: inv.workspaceName,
          role: t(`team.roles.${inv.role}`),
        })}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {t('invite.expires', { date: formatDate(inv.expiresAt, i18n.language) })}
      </p>
      {error && (
        <div className="mt-2">
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        </div>
      )}
      {signedIn ? (
        <div className="mt-3">
          <Button type="button" disabled={busy} onClick={() => void accept()}>
            {t('invite.accept')}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">{t('invite.needLogin')}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/login"
              onClick={() => rememberInvite(token)}
              className="inline-flex min-h-11 items-center underline"
            >
              {t('nav.login')}
            </Link>
            <Link
              to="/register"
              onClick={() => rememberInvite(token)}
              className="inline-flex min-h-11 items-center underline"
            >
              {t('nav.register')}
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
