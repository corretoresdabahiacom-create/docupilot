import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { TEMPLATES, type TemplateDef } from '@docupilot/shared';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useGenerated, useWorkspace } from '../lib/creation';
import { formatDate } from '../lib/format';
import { canDeleteRole, canEditRole } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');

function TemplateForm({
  tpl,
  lang,
  onCancel,
  onCreate,
  busy,
}: {
  tpl: TemplateDef;
  lang: 'pt' | 'en';
  onCancel: () => void;
  onCreate: (title: string, values: Record<string, string>) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(tpl.name[lang]);
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
        onCreate(title.trim() || tpl.name[lang], filled);
      }}
    >
      <p className="text-sm text-[var(--muted)]">{tpl.description[lang]}</p>
      <Banner>{t('create.notLegal')}</Banner>
      <Field
        id="tpl-title"
        label={t('create.docTitle')}
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <p className="text-xs text-[var(--muted)]">
        {t('create.fieldsHint', { token: '{{campo}}' })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {tpl.fields.map((f) => (
          <Field
            key={f.key}
            id={`tpl-${f.key}`}
            label={f.label[lang]}
            value={values[f.key] ?? ''}
            maxLength={500}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t('create.useTemplate')}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          className="bg-transparent !text-[var(--text)] border border-[var(--border)]"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function CreatePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('en') ? 'en' : 'pt';
  const ws = useWorkspace();
  const list = useGenerated(ws.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<TemplateDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const canEdit = canEditRole(ws.role);

  const create = async (body: Record<string, unknown>) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/workspaces/${ws.id}/generated`, {
        method: 'POST',
        body,
      });
      await qc.invalidateQueries({ queryKey: ['generated', ws.id] });
      navigate(`/create/${r.id}`);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    try {
      setConfirmId(null);
      await api(`/workspaces/${ws.id}/generated/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['generated', ws.id] });
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('create.title')}</h1>
      {error && <Banner tone="error">{error}</Banner>}

      {canEdit && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">{t('create.new')}</h2>
          {picked ? (
            <TemplateForm
              tpl={picked}
              lang={lang}
              busy={busy}
              onCancel={() => setPicked(null)}
              onCreate={(title, values) => void create({ title, template: picked.key, values })}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void create({ title: t('create.untitled') })}
                >
                  {t('create.blank')}
                </Button>
              </div>
              <h3 className="text-sm font-medium">{t('create.templates')}</h3>
              <p className="text-xs text-[var(--muted)]">{t('create.notLegal')}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((tpl) => (
                  <li key={tpl.key}>
                    <button
                      type="button"
                      onClick={() => setPicked(tpl)}
                      className="min-h-11 w-full rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--bg)]"
                    >
                      <span className="font-medium">{tpl.name[lang]}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {tpl.description[lang]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium">{t('create.mine')}</h2>
        {list.isPending && <p className="text-sm">{t('common.loading')}</p>}
        {list.data?.documents.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t('create.empty')}</p>
        )}
        <ul className="flex flex-col gap-2">
          {list.data?.documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2"
            >
              <Link to={`/create/${d.id}`} className="min-h-11 content-center underline">
                {d.title}
              </Link>
              <span className="text-xs text-[var(--muted)]">
                {formatDate(d.updatedAt, i18n.language)}
              </span>
              {canDeleteRole(ws.role) && (
                <Button type="button" danger onClick={() => void remove(d.id)}>
                  {confirmId === d.id ? t('create.confirmDelete') : t('common.delete')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
