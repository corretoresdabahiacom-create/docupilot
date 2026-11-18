import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useParams } from 'react-router';
import { Banner, Button, Card } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { canApproveRole, useExecution, useWorkspace, type ExecutionView } from '../lib/creation';
import { formatDate } from '../lib/format';
import { canEditRole } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
const ghost = 'bg-transparent !text-[var(--text)] border border-[var(--border)]';

/** Resumo legível do resultado de um passo (o log só guarda contagens, nunca o conteúdo). */
function summary(entry: ExecutionView['log'][number], t: TFunction): string {
  if (entry.error) return entry.error;
  const r = (entry.result ?? {}) as Record<string, unknown>;
  switch (entry.kind) {
    case 'input_extract':
      return t('workflows.res.extract', {
        fields: Number(r['fields'] ?? 0),
        inc: Number(r['inconsistencies'] ?? 0),
      });
    case 'compare':
      return t('workflows.res.compare', {
        equal: Number(r['equal'] ?? 0),
        changed: Number(r['changed'] ?? 0),
        onlyA: Number(r['onlyA'] ?? 0),
        onlyB: Number(r['onlyB'] ?? 0),
      });
    case 'generate': {
      const un = Array.isArray(r['unresolved']) ? r['unresolved'].length : 0;
      return t('workflows.res.generate', { filled: Number(r['filled'] ?? 0), blank: un });
    }
    case 'output':
      return t('workflows.res.output', {
        compared: r['compared'] ? 1 : 0,
        blank: Number(r['unresolved'] ?? 0),
      });
    default:
      return '';
  }
}

function DecisionPanel({ ws, ex, personal }: { ws: string; ex: ExecutionView; personal: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [modal, setModal] = useState<'approved' | 'rejected' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!modal) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/workspaces/${ws}/workflow-executions/${ex.id}/decision`, {
        method: 'POST',
        body: { decision: modal, note: note.trim() || undefined, confirm: confirm || undefined },
      });
      setModal(null);
      await qc.invalidateQueries({ queryKey: ['execution', ws, ex.id] });
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-medium">{t('workflows.approval.title')}</h2>
      <p className="text-sm">
        {personal ? t('workflows.approval.personal') : t('workflows.approval.team')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setModal('approved')}>
          {t('workflows.approval.approve')}
        </Button>
        <Button type="button" danger onClick={() => setModal('rejected')}>
          {t('workflows.approval.reject')}
        </Button>
      </div>
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-title"
          className="flex flex-col gap-3 rounded-lg border-2 border-[var(--primary)] bg-[var(--surface)] p-4"
        >
          <h3 id="decision-title" className="font-medium">
            {modal === 'approved'
              ? t('workflows.approval.confirmApprove')
              : t('workflows.approval.confirmReject')}
          </h3>
          {error && <Banner tone="error">{error}</Banner>}
          <label className="flex flex-col gap-1 text-sm">
            {t('workflows.approval.note')}
            <textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-20 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
            />
          </label>
          {personal && modal === 'approved' && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="mt-1"
              />
              {t('workflows.approval.irreversible')}
            </label>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              danger={modal === 'rejected'}
              disabled={busy || (personal && modal === 'approved' && !confirm)}
              onClick={() => void submit()}
            >
              {t('workflows.approval.submit')}
            </Button>
            <Button type="button" className={ghost} onClick={() => setModal(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ExecutionPage() {
  const { t, i18n } = useTranslation();
  const { eid } = useParams();
  const ws = useWorkspace();
  const q = useExecution(ws.id, eid);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  if (!ws.id || !eid) return null;
  if (q.isPending) return <p>{t('common.loading')}</p>;
  if (q.isError) return <Banner tone="error">{t('errors.NOT_FOUND')}</Banner>;
  const ex = q.data;

  const cancel = async () => {
    try {
      await api(`/workspaces/${ws.id}/workflow-executions/${ex.id}/cancel`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['execution', ws.id, ex.id] });
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link to="/workflows" className="min-h-11 content-center text-sm underline">
        ← {t('workflows.title')}
      </Link>
      <h1 className="text-xl font-semibold">{ex.workflowName ?? t('workflows.execution')}</h1>
      {error && <Banner tone="error">{error}</Banner>}
      <Banner
        tone={
          ex.status === 'completed' ? 'warn' : ex.status === 'awaiting_approval' ? 'warn' : 'error'
        }
      >
        {t(`workflows.status.${ex.status}`)} · {formatDate(ex.startedAt, i18n.language)}
      </Banner>
      <Card>
        <ol className="flex flex-col gap-2">
          {ex.steps.map((s) => {
            const e = ex.log.find((l) => l.position === s.position);
            return (
              <li
                key={s.position}
                className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-2"
              >
                <span className="text-sm font-medium">
                  {s.position}. {t(`workflows.kinds.${s.kind}`)} —{' '}
                  {e ? t(`workflows.stepStatus.${e.status}`) : t('workflows.stepStatus.pending')}
                  {e && e.attempts > 1
                    ? ` (${t('workflows.attempts', { count: e.attempts })})`
                    : ''}
                </span>
                {e && <span className="text-xs text-[var(--muted)]">{summary(e, t)}</span>}
              </li>
            );
          })}
        </ol>
      </Card>
      <p className="text-xs text-[var(--muted)]">{t('workflows.outputNote')}</p>
      {ex.status === 'awaiting_approval' && canApproveRole(ws.role) && (
        <DecisionPanel ws={ws.id} ex={ex} personal={ws.personal} />
      )}
      {ex.status === 'awaiting_approval' && !canApproveRole(ws.role) && (
        <Banner>{t('workflows.approval.noPermission')}</Banner>
      )}
      {ex.status === 'awaiting_approval' && canEditRole(ws.role) && (
        <div>
          <Button type="button" className={ghost} onClick={() => void cancel()}>
            {t('workflows.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
