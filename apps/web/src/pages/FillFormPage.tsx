import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  clearItem,
  confirmItem,
  confirmSuggested,
  describeFields,
  pickCandidate,
  proposeFill,
  setManual,
  summarizeFill,
  toWrite,
  type DataSource,
  type FillItem,
  type FillState,
  type Origin,
  sourcesFromProfile,
} from '@docupilot/shared';
import { Banner, Button, Card } from '../components/ui';
import { ApiError } from '../lib/api';
import { fetchDocumentBlob } from '../lib/documents';
import { filledFileName, loadProfile, loadReferenceSources, saveBlob } from '../lib/fill';
import { fillPdf, readFormFields } from '../lib/form';
import { useAllDocuments, useDocument, useMe, useProfiles } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');

type Loaded =
  | { status: 'loading' }
  | { status: 'error'; key: 'encrypted' | 'invalid' | 'noFields' | 'download' }
  | {
      status: 'ready';
      bytes: Uint8Array;
      fields: ReturnType<typeof describeFields>;
      hasXfa: boolean;
    };

const BADGE: Record<FillState, string> = {
  mapeado_automaticamente: 'border-[var(--primary)]',
  preenchido_por_regex: 'border-[var(--primary)]',
  aguardando_confirmacao: 'border-[var(--warn-text)]',
  campo_ausente: 'border-[var(--border)]',
  campo_invalido: 'border-[var(--danger)]',
  confirmado: 'border-[var(--primary)] font-semibold',
};

function originText(o: Origin): string {
  if (o.kind === 'document') return `${o.label}${o.pageNumber ? ` p.${o.pageNumber}` : ''}`;
  return o.label;
}

function Row({ item, onChange }: { item: FillItem; onChange: (next: FillItem) => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const f = item.field;
  const id = `fill-${f.name}`;

  if (!item.fillable) {
    return (
      <li className="rounded-md border border-dashed border-[var(--border)] p-2 text-sm text-[var(--muted)]">
        <span className="font-medium break-all">{f.name}</span> — {t('fill.reasons.unsupported')}
      </li>
    );
  }

  const valueText =
    typeof item.value === 'boolean'
      ? item.value
        ? t('fill.checkbox')
        : t('fill.checkboxOff')
      : (item.value ?? '');
  const apply = () => {
    const v = f.kind === 'checkbox' ? typed === 'on' : typed;
    onChange(setManual(item, v, new Date()));
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-all">
          {f.name}
          {f.required && <span aria-label="obrigatório"> *</span>}
        </span>
        <span className={`rounded border px-2 py-0.5 text-xs ${BADGE[item.state]}`}>
          {t(`fill.states.${item.state}`)}
        </span>
      </div>

      {item.reason && item.state !== 'confirmado' && (
        <p className="text-xs text-[var(--muted)]">{t(`fill.reasons.${item.reason}`)}</p>
      )}
      {item.error && item.state === 'campo_invalido' && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {t(`fill.errors.${item.error}`)}
        </p>
      )}

      {valueText !== '' && (
        <div className="text-sm">
          <span className="text-[var(--muted)]">{t('fill.value')}: </span>
          <span className="break-all">{String(valueText)}</span>
          {item.origins.length > 0 && (
            <span className="block text-xs text-[var(--muted)]">
              {t('fill.origin')}: {item.origins.map(originText).join('; ')}
              {item.via ? ` · ${t(`fill.via.${item.via}`)}` : ''}
            </span>
          )}
        </div>
      )}

      {item.state === 'aguardando_confirmacao' && item.candidates.length > 1 && (
        <div className="flex flex-col gap-1">
          {item.candidates.map((c, i) => (
            <Button
              key={c.value}
              type="button"
              className="!bg-transparent !text-[var(--text)] border border-[var(--border)] text-left"
              onClick={() => onChange(pickCandidate(item, i, new Date()))}
            >
              {t('fill.use')}: {c.value} ({c.origins.map(originText).join('; ')})
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {item.value !== null && item.state !== 'confirmado' && item.state !== 'campo_invalido' && (
          <Button type="button" onClick={() => onChange(confirmItem(item, new Date()))}>
            {t('fill.confirm')}
          </Button>
        )}
        {(item.state === 'confirmado' || item.value !== null) && (
          <Button
            type="button"
            className="!bg-transparent !text-[var(--text)] border border-[var(--border)]"
            onClick={() => onChange(clearItem(item))}
          >
            {t('fill.clear')}
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-end gap-2">
          <label htmlFor={id} className="sr-only">
            {t('fill.type')}: {f.name}
          </label>
          {f.kind === 'checkbox' ? (
            <select
              id={id}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
            >
              <option value="">{t('fill.type')}</option>
              <option value="on">{t('fill.checkbox')}</option>
              <option value="off">{t('fill.checkboxOff')}</option>
            </select>
          ) : f.kind === 'choice' ? (
            <select
              id={id}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
            >
              <option value="">{t('fill.type')}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={id}
              value={typed}
              placeholder={t('fill.type')}
              maxLength={f.maxLength ?? 500}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            />
          )}
          <Button type="button" disabled={typed === ''} onClick={apply}>
            {t('fill.typeApply')}
          </Button>
        </div>
      </div>
    </li>
  );
}

export function FillFormPage() {
  const { t } = useTranslation();
  const { documentId } = useParams();
  const me = useMe();
  const ws = me.data?.workspaces[0]?.id;
  const detail = useDocument(ws, documentId);
  const allDocs = useAllDocuments(ws);
  const profiles = useProfiles();
  const doc = detail.data?.document;
  const versionId = doc?.currentVersionId;

  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [profileId, setProfileId] = useState('');
  const [profileSources, setProfileSources] = useState<DataSource[]>([]);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refSources, setRefSources] = useState<DataSource[]>([]);
  const [items, setItems] = useState<FillItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    written: number;
    blank: string[];
    failed: string[];
  } | null>(null);

  // Lê o PDF e seus campos no navegador.
  useEffect(() => {
    if (!ws || !doc || !versionId) return;
    if (doc.mime !== 'application/pdf') return;
    let cancelled = false;
    void (async () => {
      setLoaded({ status: 'loading' });
      try {
        const blob = await fetchDocumentBlob(ws, doc.id, versionId);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const read = await readFormFields(bytes);
        if (cancelled) return;
        if (!read.ok) return setLoaded({ status: 'error', key: read.reason });
        const fields = describeFields(read.fields);
        if (fields.length === 0) return setLoaded({ status: 'error', key: 'noFields' });
        setLoaded({ status: 'ready', bytes, fields, hasXfa: read.hasXfa });
      } catch {
        if (!cancelled) setLoaded({ status: 'error', key: 'download' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, doc?.id, doc?.mime, versionId]);

  const sources = useMemo(() => [...profileSources, ...refSources], [profileSources, refSources]);
  const summary = useMemo(() => (items ? summarizeFill(items) : null), [items]);
  const suggested = items
    ? items.filter(
        (i) => i.state === 'mapeado_automaticamente' || i.state === 'preenchido_por_regex',
      ).length
    : 0;

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }));
    } finally {
      setBusy(false);
    }
  };

  const useProfile = () =>
    guard(async () => {
      if (!profileId) return setProfileSources([]);
      const p = await loadProfile(profileId);
      setProfileSources(sourcesFromProfile(p.fields, p.label));
      setNotice(t('fill.profileLoaded', { name: p.label }));
    });

  const useReferences = () =>
    guard(async () => {
      if (!ws) return;
      const docs = (allDocs.data?.documents ?? []).filter((d) => refIds.includes(d.id));
      const out = await loadReferenceSources(ws, docs);
      setRefSources(out);
      setNotice(t('fill.referencesLoaded', { n: out.length, docs: docs.length }));
    });

  const propose = () => {
    if (loaded.status !== 'ready') return;
    setResult(null);
    setItems(proposeFill(loaded.fields, sources, new Date()));
  };

  const update = (idx: number, next: FillItem) =>
    setItems((cur) => (cur ? cur.map((x, i) => (i === idx ? next : x)) : cur));

  const generate = () =>
    guard(async () => {
      if (loaded.status !== 'ready' || !items || !doc) return;
      const out = await fillPdf(loaded.bytes, toWrite(items));
      const written = new Set(out.written);
      saveBlob(out.bytes, filledFileName(doc.name), 'application/pdf');
      setResult({
        written: out.written.length,
        blank: items
          .filter((i) => i.fillable && !written.has(i.field.name))
          .map((i) => i.field.name),
        failed: out.failed.map((f) => f.name),
      });
    });

  if (me.isPending || detail.isPending) return <p>{t('common.loading')}</p>;
  if (!doc) return <Banner tone="error">{t('errors.NOT_FOUND')}</Banner>;

  return (
    <>
      <Link to={`/documents/${doc.id}`} className="min-h-11 content-center text-sm underline">
        ← {t('fill.back')}
      </Link>
      <h1 className="text-xl font-semibold break-all">
        {t('fill.title')}: {doc.name}
      </h1>
      <Banner>{t('fill.notice')}</Banner>

      {doc.mime !== 'application/pdf' && <Banner tone="error">{t('fill.notPdf')}</Banner>}
      {doc.mime === 'application/pdf' && loaded.status === 'loading' && <p>{t('fill.reading')}</p>}
      {loaded.status === 'error' && (
        <Banner tone="error">
          {loaded.key === 'download' ? t('errors.DOWNLOAD_FAILED') : t(`fill.${loaded.key}`)}
        </Banner>
      )}
      {loaded.status === 'ready' && loaded.hasXfa && <Banner>{t('fill.xfa')}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner>{notice}</Banner>}

      {loaded.status === 'ready' && (
        <>
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">{t('fill.sources')}</h2>

            <div className="flex flex-col gap-2">
              <label htmlFor="fill-profile" className="text-sm font-medium">
                {t('fill.profile')}
              </label>
              <div className="flex flex-wrap gap-2">
                <select
                  id="fill-profile"
                  value={profileId}
                  onChange={(e) => {
                    setProfileId(e.target.value);
                    if (e.target.value === '') setProfileSources([]);
                  }}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                >
                  <option value="">{t('fill.noProfile')}</option>
                  {(profiles.data?.profiles ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={busy || !profileId}
                  onClick={() => void useProfile()}
                >
                  {t('fill.useProfile')}
                </Button>
              </div>
              <Link to="/profiles" className="text-sm underline">
                {t('fill.profilesLink')}
              </Link>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('fill.references')}</legend>
              <p className="text-xs text-[var(--muted)]">{t('fill.referencesHint')}</p>
              {(allDocs.data?.documents ?? []).filter((d) => d.id !== doc.id).length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t('fill.noReferences')}</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
                  {(allDocs.data?.documents ?? [])
                    .filter((d) => d.id !== doc.id)
                    .map((d) => (
                      <li key={d.id}>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={refIds.includes(d.id)}
                            onChange={(e) =>
                              setRefIds((cur) =>
                                e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id),
                              )
                            }
                          />
                          <span className="break-all">{d.name}</span>
                        </label>
                      </li>
                    ))}
                </ul>
              )}
              <div>
                <Button
                  type="button"
                  disabled={busy || refIds.length === 0}
                  onClick={() => void useReferences()}
                >
                  {t('fill.loadReferences')}
                </Button>
              </div>
            </fieldset>

            <div>
              <Button type="button" onClick={propose}>
                {items ? t('fill.proposeAgain') : t('fill.propose')}
              </Button>
            </div>
          </Card>

          {items && summary && (
            <>
              <Card className="flex flex-col gap-2">
                <p role="status" className="text-sm font-medium">
                  {t('fill.summary', {
                    confirmed: summary.confirmed,
                    blank: summary.blank,
                    unsupported: summary.unsupported,
                  })}
                </p>
                {summary.requiredMissing.length > 0 && (
                  <Banner>
                    {t('fill.requiredMissing', { names: summary.requiredMissing.join(', ') })}
                  </Banner>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={suggested === 0}
                    onClick={() =>
                      setItems((cur) => (cur ? confirmSuggested(cur, new Date()) : cur))
                    }
                  >
                    {t('fill.confirmSuggested', { n: suggested })}
                  </Button>
                  <span className="text-xs text-[var(--muted)]">
                    {t('fill.confirmSuggestedHint')}
                  </span>
                </div>
              </Card>

              <ul className="flex flex-col gap-2">
                {items.map((item, idx) => (
                  <Row key={item.field.name} item={item} onChange={(n) => update(idx, n)} />
                ))}
              </ul>

              <Card className="flex flex-col gap-2">
                <div>
                  <Button
                    type="button"
                    disabled={busy || summary.confirmed === 0}
                    onClick={() => void generate()}
                  >
                    {busy ? t('fill.generating') : t('fill.generate')}
                  </Button>
                </div>
                {result && (
                  <div role="status" className="flex flex-col gap-1 text-sm">
                    <p className="font-medium">{t('fill.done', { n: result.written })}</p>
                    {result.blank.length > 0 && (
                      <p className="break-all">
                        {t('fill.blankList', { names: result.blank.join(', ') })}
                      </p>
                    )}
                    {result.failed.length > 0 && (
                      <p role="alert" className="break-all text-[var(--danger)]">
                        {t('fill.failedList', { names: result.failed.join(', ') })}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
