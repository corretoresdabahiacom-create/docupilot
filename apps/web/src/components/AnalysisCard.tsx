import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  PREDEFINED_QUERIES,
  selectForQuery,
  summarize,
  SUMMARY_MODES,
  type PredefinedQuery,
  type SummaryMode,
  type SummaryResult,
} from '@docupilot/shared';
import {
  ApiError,
  type AnalysisField,
  type AnalysisFinding,
  type AnalysisResponse,
} from '../lib/api';
import { fetchAllPages, runAnalysis } from '../lib/analysis';
import { fetchDocumentBlob } from '../lib/documents';
import { formatDate } from '../lib/format';
import { useAnalysis, useSearch } from '../lib/queries';
import { Snippet } from './Snippet';
import { Banner, Button, Card, Field } from './ui';

type Tab = 'fields' | 'quick' | 'search' | 'summary' | 'issues';
const TABS: Tab[] = ['fields', 'quick', 'search', 'summary', 'issues'];

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');

/** Rótulo ordenado de confiança (docs/heuristics.md §0.2): não é probabilidade. */
export function confidenceKey(c: number): 'exact' | 'high' | 'medium' | 'heuristic' {
  if (c >= 1) return 'exact';
  if (c >= 0.9) return 'high';
  if (c >= 0.7) return 'medium';
  return 'heuristic';
}

function SourceList({ sources, docId }: { sources: AnalysisField['sources']; docId: string }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {sources.map((s, i) => (
        <li key={`${s.pageNumber}-${s.start}-${i}`} className="text-xs">
          <Link
            to={`/documents/${docId}?page=${s.pageNumber}`}
            className="font-medium underline-offset-2 hover:underline"
          >
            {t('analysis.page', { n: s.pageNumber })}
          </Link>
          <Snippet value={s.snippet} />
        </li>
      ))}
    </ul>
  );
}

function FieldRow({ field, docId }: { field: AnalysisField; docId: string }) {
  const { t } = useTranslation();
  const suggested = field.sourceKind !== 'deterministic';
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-semibold break-all">{field.normalizedValue}</span>
        {field.label && (
          <span className="text-xs text-[var(--muted)]">
            {t('analysis.label')}: {field.label}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`rounded px-1.5 ${suggested ? 'bg-[var(--warn-bg)] text-[var(--warn-text)]' : 'border border-[var(--border)]'}`}
        >
          {t(suggested ? 'analysis.kind.suggested' : 'analysis.kind.extracted')}
        </span>
        <span className="text-[var(--muted)]">
          {t(`analysis.confidence.${confidenceKey(field.confidence)}`)} · {field.patternId}
        </span>
      </div>
      {field.rawValue !== field.normalizedValue && (
        <span className="text-xs text-[var(--muted)]">
          {t('analysis.raw')}: <span className="font-mono break-all">{field.rawValue}</span>
        </span>
      )}
      {field.patternId.startsWith('address_br_heuristic') && (
        <span className="text-xs text-[var(--warn-text)]">{t('analysis.warn.address')}</span>
      )}
      <SourceList sources={field.sources} docId={docId} />
    </li>
  );
}

function FieldsTab({ data, docId }: { data: AnalysisResponse; docId: string }) {
  const { t } = useTranslation();
  if (data.fields.length === 0) return <p className="text-sm">{t('analysis.noFields')}</p>;
  const groups = new Map<string, AnalysisField[]>();
  for (const f of data.fields) groups.set(f.fieldType, [...(groups.get(f.fieldType) ?? []), f]);
  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([type, items]) => (
        <section key={type} aria-label={t(`analysis.type.${type}`, { defaultValue: type })}>
          <h3 className="text-sm font-semibold">
            {t(`analysis.type.${type}`, { defaultValue: type })} ({items.length})
          </h3>
          <ul className="divide-y divide-[var(--border)]">
            {items.map((f) => (
              <FieldRow key={f.id} field={f} docId={docId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function QuickTab({ data, docId }: { data: AnalysisResponse; docId: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState<PredefinedQuery | null>(null);
  const answers = q ? selectForQuery(q, data.fields) : [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('analysis.quick.note')}</p>
      <div className="flex flex-wrap gap-2">
        {PREDEFINED_QUERIES.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={q === k}
            onClick={() => setQ(k)}
            className={`min-h-11 rounded-md border px-3 text-sm ${q === k ? 'border-[var(--primary)] font-semibold' : 'border-[var(--border)]'}`}
          >
            {t(`analysis.quick.${k}`)}
          </button>
        ))}
      </div>
      {q && answers.length === 0 && <p className="text-sm">{t('analysis.quick.none')}</p>}
      {q && answers.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {answers.map((f) => (
            <FieldRow key={f.id} field={f} docId={docId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchTab({ workspaceId, docId }: { workspaceId: string; docId: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const search = useSearch(workspaceId, q, docId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('analysis.search.disclaimer')}</p>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            id="doc-search"
            type="search"
            label={t('analysis.search.label')}
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit">{t('search.button')}</Button>
      </form>
      {q.length >= 2 && search.isPending && (
        <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>
      )}
      {search.isError && (
        <Banner tone="error">
          {t(`errors.${errorKey(search.error)}`, { defaultValue: t('errors.INTERNAL') })}
        </Banner>
      )}
      {search.data && search.data.results.length === 0 && (
        <p className="text-sm">{t('analysis.search.none')}</p>
      )}
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {search.data?.results.map((r) => (
          <li key={`${r.pageNumber}`} className="flex flex-col gap-1 py-2">
            <Link
              to={`/documents/${docId}?page=${r.pageNumber}`}
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              {t(r.pageKind === 'page' ? 'preview.page' : 'preview.section', { n: r.pageNumber })}
            </Link>
            <Snippet value={r.snippet} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryTab({ workspaceId, docId }: { workspaceId: string; docId: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SummaryMode | null>(null);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (m: SummaryMode) => {
    setMode(m);
    setBusy(true);
    setError(null);
    try {
      const pages = await fetchAllPages(workspaceId, docId);
      setResult(summarize(pages, m));
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('analysis.summary.notice')}</p>
      <div className="flex flex-wrap gap-2">
        {SUMMARY_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={busy}
            onClick={() => void run(m)}
            className={`min-h-11 rounded-md border px-3 text-sm ${mode === m ? 'border-[var(--primary)] font-semibold' : 'border-[var(--border)]'}`}
          >
            {t(`analysis.summary.mode.${m}`)}
          </button>
        ))}
        {(['clauses', 'obligations'] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled
            aria-disabled="true"
            className="min-h-11 rounded-md border border-dashed border-[var(--border)] px-3 text-sm opacity-60"
          >
            {t(`analysis.summary.mode.${k}`)} — {t('analysis.summary.requiresAi')}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">{t('analysis.summary.aiOff')}</p>
      {busy && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {error && (
        <Banner tone="error">{t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
      )}
      {result && !busy && (
        <>
          {result.groups.length === 0 && <p className="text-sm">{t('analysis.summary.empty')}</p>}
          {result.truncated && <Banner>{t('analysis.summary.truncated')}</Banner>}
          {result.groups.map((g, gi) => (
            <ul key={gi} className="flex flex-col gap-2 border-l-2 border-[var(--border)] pl-3">
              {g.sentences.map((s) => (
                <li key={`${s.pageNumber}-${s.start}`} className="text-sm">
                  {s.date && <span className="mr-2 font-mono text-xs">{s.date}</span>}
                  {s.text}{' '}
                  <Link
                    to={`/documents/${docId}?page=${s.pageNumber}`}
                    className="text-xs underline"
                  >
                    ({t('analysis.page', { n: s.pageNumber })})
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </>
      )}
    </div>
  );
}

function FindingRow({ f, docId }: { f: AnalysisFinding; docId: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-[var(--border)] px-1.5 text-xs">
          {t(`analysis.category.${f.category}`)}
        </span>
        {f.reportedBy === 'client' && (
          <span className="text-xs text-[var(--muted)]">{t('analysis.reportedByBrowser')}</span>
        )}
      </div>
      <p className="text-sm font-medium">{t(`analysis.rule.${f.ruleId}`, f.detail)}</p>
      <ul className="flex flex-col gap-1">
        {f.evidence.map((e, i) => (
          <li key={i} className="text-xs">
            <Link
              to={`/documents/${docId}?page=${e.pageNumber}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {t('analysis.page', { n: e.pageNumber })}
            </Link>
            {e.snippet && <Snippet value={e.snippet} />}
          </li>
        ))}
      </ul>
    </li>
  );
}

function IssuesTab({ data, docId }: { data: AnalysisResponse; docId: string }) {
  const { t } = useTranslation();
  const { exact, similar } = data.duplicates;
  const empty = data.inconsistencies.length === 0 && exact.length === 0 && similar.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('analysis.issues.note')}</p>
      {empty && <p className="text-sm">{t('analysis.issues.none')}</p>}
      <ul className="divide-y divide-[var(--border)]">
        {exact.map((d) => (
          <li key={`e-${d.documentId}`} className="flex flex-col gap-1 py-3">
            <span className="w-fit rounded border border-[var(--border)] px-1.5 text-xs">
              {t('analysis.category.erro_confirmado_por_regra')}
            </span>
            <p className="text-sm font-medium">
              {t('analysis.rule.duplicate_exact', { name: d.name })}{' '}
              <Link to={`/documents/${d.documentId}`} className="text-xs underline">
                {t('analysis.open')}
              </Link>
            </p>
          </li>
        ))}
        {similar.map((d) => (
          <li key={`s-${d.documentId}`} className="flex flex-col gap-1 py-3">
            <span className="w-fit rounded border border-[var(--border)] px-1.5 text-xs">
              {t('analysis.category.divergencia_identificada')}
            </span>
            <p className="text-sm font-medium">
              {t('analysis.rule.duplicate_similar', { name: d.name, distance: d.distance })}{' '}
              <Link to={`/documents/${d.documentId}`} className="text-xs underline">
                {t('analysis.open')}
              </Link>
            </p>
            <p className="text-xs text-[var(--muted)]">
              {t('analysis.similarWarn', { max: data.duplicates.similarThreshold })}
            </p>
          </li>
        ))}
        {data.inconsistencies.map((f, i) => (
          <FindingRow key={f.id ?? i} f={f} docId={docId} />
        ))}
      </ul>
    </div>
  );
}

export function AnalysisCard({
  workspaceId,
  documentId,
  versionId,
  mime,
  canEdit,
}: {
  workspaceId: string;
  documentId: string;
  versionId: string | null;
  mime: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const analysis = useAnalysis(workspaceId, documentId);
  const [tab, setTab] = useState<Tab>('fields');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const analyze = async () => {
    if (!versionId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // O PDF original só serve para ler campos de formulário; sem ele a análise segue sem essa regra.
      const pdf =
        mime === 'application/pdf'
          ? await fetchDocumentBlob(workspaceId, documentId, versionId).catch(() => undefined)
          : undefined;
      const saved = await runAnalysis(workspaceId, { documentId, versionId, mime }, pdf);
      if (saved.rejected > 0) setNotice(t('analysis.rejected', { n: saved.rejected }));
      await qc.invalidateQueries({ queryKey: ['analysis', workspaceId, documentId] });
      await qc.invalidateQueries({ queryKey: ['document', workspaceId, documentId] });
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const data = analysis.data;
  const fresh = data?.status === 'fresh';
  const meta = data?.analysis;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{t('analysis.title')}</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">{t('analysis.intro')}</p>

      {analysis.isPending && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {analysis.isError && (
        <Banner tone="error">
          {t(`errors.${errorKey(analysis.error)}`, { defaultValue: t('errors.INTERNAL') })}
        </Banner>
      )}

      {data && (
        <p className="mb-2 text-sm">
          {data.status === 'none' && t('analysis.status.none')}
          {data.status === 'stale' && t('analysis.status.stale')}
          {fresh &&
            meta &&
            t('analysis.status.fresh', {
              date: formatDate(meta.analyzedAt, i18n.language),
              fields: meta.fields,
              occurrences: meta.occurrences,
            })}
        </p>
      )}
      {fresh && meta && meta.truncated.fields > 0 && (
        <div className="mb-2">
          <Banner>{t('analysis.truncated', { n: meta.truncated.fields })}</Banner>
        </div>
      )}
      {notice && (
        <div className="mb-2">
          <Banner>{notice}</Banner>
        </div>
      )}
      {error && (
        <div className="mb-2">
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        </div>
      )}

      {canEdit && data && (
        <div className="mb-3">
          <Button type="button" onClick={() => void analyze()} disabled={busy || !versionId}>
            {busy
              ? t('analysis.running')
              : data.status === 'fresh'
                ? t('analysis.rerun')
                : t('analysis.run')}
          </Button>
        </div>
      )}

      {data && (
        <>
          <div
            role="tablist"
            aria-label={t('analysis.title')}
            className="mb-3 flex flex-wrap gap-1"
          >
            {TABS.map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`min-h-11 rounded-md border px-3 text-sm ${tab === k ? 'border-[var(--primary)] font-semibold' : 'border-[var(--border)]'}`}
              >
                {t(`analysis.tab.${k}`)}
              </button>
            ))}
          </div>
          {(tab === 'fields' || tab === 'quick' || tab === 'issues') && !fresh && (
            <p className="text-sm">{t('analysis.needsRun')}</p>
          )}
          {tab === 'fields' && fresh && <FieldsTab data={data} docId={documentId} />}
          {tab === 'quick' && fresh && <QuickTab data={data} docId={documentId} />}
          {tab === 'search' && <SearchTab workspaceId={workspaceId} docId={documentId} />}
          {tab === 'summary' && <SummaryTab workspaceId={workspaceId} docId={documentId} />}
          {tab === 'issues' && (fresh || data.duplicates.exact.length > 0) && (
            <IssuesTab data={data} docId={documentId} />
          )}
        </>
      )}
    </Card>
  );
}
