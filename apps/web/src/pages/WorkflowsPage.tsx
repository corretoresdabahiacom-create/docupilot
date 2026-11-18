import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  MAX_STEPS,
  STEP_KINDS,
  TEMPLATES,
  getTemplate,
  validateStepOrder,
  workflowInputSchema,
  type StepKind,
} from '@docupilot/shared';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useWorkflow, useWorkflows, useWorkspace } from '../lib/creation';
import { canDeleteRole, canEditRole, useAllDocuments } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
const ghost = 'bg-transparent !text-[var(--text)] border border-[var(--border)]';

type Draft = { kind: StepKind; config: Record<string, unknown> };
const blank = (kind: StepKind): Draft => ({
  kind,
  config:
    kind === 'input_extract'
      ? { input: 'primary' }
      : kind === 'validate'
        ? { requiredTypes: [], failOnInconsistency: false }
        : kind === 'generate'
          ? { templateKey: 'declaracao', title: '', mapping: {} }
          : {},
});

function StepEditor({
  step,
  idx,
  onChange,
}: {
  step: Draft;
  idx: number;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('en') ? 'en' : 'pt';
  const c = step.config;
  if (step.kind === 'input_extract') {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {t('workflows.input')}
        <select
          value={String(c['input'])}
          onChange={(e) => onChange({ input: e.target.value })}
          className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2"
        >
          <option value="primary">{t('workflows.primary')}</option>
          <option value="secondary">{t('workflows.secondary')}</option>
        </select>
      </label>
    );
  }
  if (step.kind === 'validate') {
    return (
      <div className="flex flex-col gap-2">
        <Field
          id={`step${idx}-req`}
          label={t('workflows.requiredTypes')}
          hint={t('workflows.requiredTypesHint')}
          value={((c['requiredTypes'] as string[]) ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              ...c,
              requiredTypes: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(c['failOnInconsistency'])}
            onChange={(e) => onChange({ ...c, failOnInconsistency: e.target.checked })}
          />
          {t('workflows.failOnInconsistency')}
        </label>
      </div>
    );
  }
  if (step.kind === 'generate') {
    const tpl = getTemplate(String(c['templateKey']));
    const mapping = (c['mapping'] as Record<string, { fieldType: string }>) ?? {};
    return (
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t('workflows.template')}
          <select
            value={String(c['templateKey'])}
            onChange={(e) => onChange({ ...c, templateKey: e.target.value, mapping: {} })}
            className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2"
          >
            {TEMPLATES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name[lang]}
              </option>
            ))}
          </select>
        </label>
        <Field
          id={`step${idx}-title`}
          label={t('create.docTitle')}
          value={String(c['title'] ?? '')}
          maxLength={200}
          onChange={(e) => onChange({ ...c, title: e.target.value })}
        />
        <p className="text-xs text-[var(--muted)]">{t('workflows.mappingHint')}</p>
        {tpl?.fields.map((f) => (
          <Field
            key={f.key}
            id={`step${idx}-map-${f.key}`}
            label={`${f.label[lang]} ← ${t('workflows.fieldType')}`}
            value={mapping[f.key]?.fieldType ?? ''}
            placeholder="cnpj, cpf, date, money…"
            onChange={(e) => {
              const next = { ...mapping };
              if (e.target.value.trim()) next[f.key] = { fieldType: e.target.value.trim() };
              else delete next[f.key];
              onChange({ ...c, mapping: next });
            }}
          />
        ))}
      </div>
    );
  }
  if (step.kind === 'approval') {
    return (
      <Field
        id={`step${idx}-note`}
        label={t('workflows.approvalNote')}
        value={String(c['note'] ?? '')}
        maxLength={300}
        onChange={(e) => onChange(e.target.value ? { note: e.target.value } : {})}
      />
    );
  }
  return <p className="text-sm text-[var(--muted)]">{t(`workflows.kindHelp.${step.kind}`)}</p>;
}

function Builder({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Draft[]>([blank('input_extract')]);
  const [add, setAdd] = useState<StepKind>('validate');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j] as Draft, next[i] as Draft];
    setSteps(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = workflowInputSchema.safeParse({ name, steps });
    if (!parsed.success) {
      setError(t('workflows.invalid'));
      return;
    }
    const order = validateStepOrder(parsed.data.steps);
    if (order) {
      setError(`${t('workflows.invalidOrder')} ${order}`);
      return;
    }
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}/workflows`, { method: 'POST', body: parsed.data });
      onDone();
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-[var(--muted)]">{t('workflows.rules', { max: MAX_STEPS })}</p>
      {error && <Banner tone="error">{error}</Banner>}
      <Field
        id="wf-name"
        label={t('workflows.name')}
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">
                {i + 1}. {t(`workflows.kinds.${s.kind}`)}
              </strong>
              <div className="flex gap-1">
                <Button
                  type="button"
                  className={ghost}
                  aria-label={t('workflows.up')}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  className={ghost}
                  aria-label={t('workflows.down')}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  danger
                  aria-label={t('workflows.remove')}
                  onClick={() => setSteps(steps.filter((_, k) => k !== i))}
                >
                  ✕
                </Button>
              </div>
            </div>
            <StepEditor
              step={s}
              idx={i}
              onChange={(config) => setSteps(steps.map((x, k) => (k === i ? { ...x, config } : x)))}
            />
          </li>
        ))}
      </ol>
      {steps.length < MAX_STEPS && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t('workflows.addStep')}
            <select
              value={add}
              onChange={(e) => setAdd(e.target.value as StepKind)}
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2"
            >
              {STEP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`workflows.kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" className={ghost} onClick={() => setSteps([...steps, blank(add)])}>
            {t('workflows.add')}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t('common.save')}
        </Button>
        <Button type="button" className={ghost} onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function RunPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const docs = useAllDocuments(ws.id);
  const wfq = useWorkflow(ws.id, id);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wf = wfq.data;
  if (!wf) return <p className="text-sm">{t('common.loading')}</p>;
  const analysed = docs.data?.documents ?? [];
  const select = (value: string, set: (v: string) => void, label: string, htmlId: string) => (
    <label className="flex flex-col gap-1 text-sm" htmlFor={htmlId}>
      {label}
      <select
        id={htmlId}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2"
      >
        <option value="">—</option>
        {analysed.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`/workspaces/${ws.id}/workflows/${id}/run`, {
        method: 'POST',
        body: {
          ...(primary ? { primaryDocumentId: primary } : {}),
          ...(secondary ? { secondaryDocumentId: secondary } : {}),
        },
      });
      navigate(`/workflows/executions/${r.id}`);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
      setBusy(false);
    }
  };

  const needsPrimary = wf.inputs.includes('primary');
  const needsSecondary = wf.inputs.includes('secondary');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('workflows.runHint')}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {needsPrimary && select(primary, setPrimary, t('workflows.primary'), `run-primary-${id}`)}
      {needsSecondary &&
        select(secondary, setSecondary, t('workflows.secondary'), `run-secondary-${id}`)}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || (needsPrimary && !primary) || (needsSecondary && !secondary)}
          onClick={() => void run()}
        >
          {t('workflows.run')}
        </Button>
        <Button type="button" className={ghost} onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function WorkflowsPage() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const list = useWorkflows(ws.id);
  const qc = useQueryClient();
  const [building, setBuilding] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = canEditRole(ws.role);

  const remove = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    try {
      await api(`/workspaces/${ws.id}/workflows/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['workflows', ws.id] });
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('workflows.title')}</h1>
      <Banner>{t('workflows.notice')}</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      {canEdit &&
        (building ? (
          <Card>
            <Builder
              onDone={() => {
                setBuilding(false);
                void qc.invalidateQueries({ queryKey: ['workflows', ws.id] });
              }}
            />
          </Card>
        ) : (
          <div>
            <Button type="button" onClick={() => setBuilding(true)}>
              {t('workflows.new')}
            </Button>
          </div>
        ))}
      <Card className="flex flex-col gap-2">
        {list.isPending && <p className="text-sm">{t('common.loading')}</p>}
        {list.data?.workflows.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t('workflows.empty')}</p>
        )}
        <ul className="flex flex-col gap-3">
          {list.data?.workflows.map((w) => (
            <li key={w.id} className="flex flex-col gap-2 border-b border-[var(--border)] pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {w.name}{' '}
                  <span className="text-xs text-[var(--muted)]">
                    ({t('workflows.stepCount', { count: w.steps })})
                  </span>
                </span>
                <div className="flex gap-2">
                  {canEdit && (
                    <Button
                      type="button"
                      onClick={() => setRunning(running === w.id ? null : w.id)}
                    >
                      {t('workflows.run')}
                    </Button>
                  )}
                  {canDeleteRole(ws.role) && (
                    <Button type="button" danger onClick={() => void remove(w.id)}>
                      {confirmId === w.id ? t('create.confirmDelete') : t('common.delete')}
                    </Button>
                  )}
                </div>
              </div>
              {running === w.id && <RunPanel id={w.id} onClose={() => setRunning(null)} />}
            </li>
          ))}
        </ul>
      </Card>
      <Link to="/notifications" className="min-h-11 content-center text-sm underline">
        {t('notifications.title')}
      </Link>
    </div>
  );
}
