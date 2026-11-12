import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  EXPORT_FORMATS,
  type ClauseDiffStatus,
  type ComparedClause,
  type ComparedField,
  type ComparisonResult,
  type Context,
  type ExportFormat,
  type FieldDiffStatus,
  type InlinePart,
  type TextHunk,
} from '@docupilot/shared';
import { Banner, Button, Card } from '../components/ui';
import { ApiError } from '../lib/api';
import { downloadExport, loadAndCompare, NoTextError, type CompareSide } from '../lib/compare';
import { formatDate } from '../lib/format';
import { useAllDocuments, useDocument, useMe } from '../lib/queries';

type Tab = 'text' | 'fields' | 'clauses';
const TABS: Tab[] = ['text', 'fields', 'clauses'];
const HUNK_LIMIT = 100;

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');

// ---------- seleção ----------

function SidePicker({
  ws,
  title,
  value,
  onChange,
}: {
  ws: string;
  title: string;
  value: { documentId: string; versionId: string };
  onChange: (v: { documentId: string; versionId: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const docs = useAllDocuments(ws);
  const detail = useDocument(ws, value.documentId || undefined);
  const versions = detail.data?.versions ?? [];
  const currentId = detail.data?.document.currentVersionId ?? '';

  // Ao escolher o documento, a versão atual vem selecionada.
  useEffect(() => {
    if (value.documentId && !value.versionId && currentId) {
      onChange({ documentId: value.documentId, versionId: currentId });
    }
  }, [value.documentId, value.versionId, currentId, onChange]);

  const docId = `${title}-doc`;
  const verId = `${title}-ver`;
  return (
    <fieldset className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-[var(--border)] p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <label htmlFor={docId} className="text-sm font-medium">
        {t('compare.document')}
      </label>
      <select
        id={docId}
        className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={value.documentId}
        onChange={(e) => onChange({ documentId: e.target.value, versionId: '' })}
      >
        <option value="">{t('compare.choose')}</option>
        {docs.data?.documents.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <label htmlFor={verId} className="text-sm font-medium">
        {t('compare.version')}
      </label>
      <select
        id={verId}
        className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={value.versionId}
        disabled={!value.documentId}
        onChange={(e) => onChange({ documentId: value.documentId, versionId: e.target.value })}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {t('versions.number', { n: v.versionNumber })} —{' '}
            {formatDate(v.createdAt, i18n.language)}
            {v.id === currentId ? ` (${t('versions.current')})` : ''}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

// ---------- apresentação ----------

function Badge({ children, tone }: { children: string; tone?: 'warn' }) {
  return (
    <span
      className={`rounded border px-1.5 text-xs ${
        tone === 'warn'
          ? 'border-transparent bg-[var(--warn-bg)] text-[var(--warn-text)]'
          : 'border-[var(--border)]'
      }`}
    >
      {children}
    </span>
  );
}

/** Linha com destaque só nas palavras que mudaram; sempre texto, nunca HTML. */
function Inline({ parts, side }: { parts: InlinePart[]; side: 'a' | 'b' }) {
  const mark = side === 'a' ? 'removed' : 'added';
  return (
    <>
      {parts
        .filter((p) => p.kind === 'same' || p.kind === mark)
        .map((p, i) =>
          p.kind === 'same' ? (
            <span key={i}>{p.text}</span>
          ) : (
            <mark
              key={i}
              className={`rounded px-0.5 ${side === 'a' ? 'bg-[var(--warn-bg)] text-[var(--warn-text)] line-through' : 'bg-[var(--warn-bg)] text-[var(--warn-text)] font-semibold underline'}`}
            >
              {p.text}
            </mark>
          ),
        )}
    </>
  );
}

function PageRef({ n, side }: { n: number; side: 'A' | 'B' }) {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-[var(--muted)]">
      {side} · {t('analysis.page', { n })}
    </span>
  );
}

function HunkView({ hunk }: { hunk: TextHunk }) {
  const { t } = useTranslation();
  const Line = ({
    sign,
    label,
    children,
  }: {
    sign: string;
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="flex gap-2 text-sm">
      <span aria-label={label} className="w-4 shrink-0 font-mono font-bold">
        {sign}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
  return (
    <li className="flex flex-col gap-1 rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap gap-2">
        <Badge>{t(`compare.hunk.${hunk.kind}`)}</Badge>
        {hunk.a[0] && <PageRef n={hunk.a[0].pageNumber} side="A" />}
        {hunk.b[0] && <PageRef n={hunk.b[0].pageNumber} side="B" />}
      </div>
      {hunk.kind === 'changed' && hunk.inline ? (
        hunk.a.map((u, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Line sign="−" label={t('compare.removedLine')}>
              <Inline parts={hunk.inline?.[i] ?? []} side="a" />
            </Line>
            <Line sign="+" label={t('compare.addedLine')}>
              <Inline parts={hunk.inline?.[i] ?? []} side="b" />
            </Line>
            <span className="sr-only">{u.text}</span>
          </div>
        ))
      ) : (
        <>
          {hunk.a.map((u, i) => (
            <Line key={`a${i}`} sign="−" label={t('compare.removedLine')}>
              {u.text}
            </Line>
          ))}
          {hunk.b.map((u, i) => (
            <Line key={`b${i}`} sign="+" label={t('compare.addedLine')}>
              {u.text}
            </Line>
          ))}
        </>
      )}
    </li>
  );
}

function TextTab({ result }: { result: ComparisonResult }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const changes = result.text.hunks.filter((h) => h.kind !== 'equal');
  const shown = all ? changes : changes.slice(0, HUNK_LIMIT);
  if (changes.length === 0) return <p className="text-sm">{t('compare.text.identical')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {shown.map((h, i) => (
          <HunkView key={i} hunk={h} />
        ))}
      </ul>
      {!all && changes.length > HUNK_LIMIT && (
        <Button type="button" onClick={() => setAll(true)}>
          {t('compare.showAll', { n: changes.length })}
        </Button>
      )}
    </div>
  );
}

function Origin({ ctx }: { ctx: Context }) {
  return (
    <span className="text-xs text-[var(--muted)]">
      …{ctx.before}{' '}
      <mark className="rounded bg-[var(--warn-bg)] px-0.5 text-[var(--warn-text)]">
        {ctx.match}
      </mark>{' '}
      {ctx.after}…
    </span>
  );
}

function FieldRow({ f }: { f: ComparedField }) {
  const { t } = useTranslation();
  const col = (side: 'a' | 'b') => {
    const v = f[side];
    if (!v) return <span className="text-sm text-[var(--muted)]">{t('compare.absent')}</span>;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-sm font-semibold break-all">{v.normalized}</span>
        {v.sources.map((s, i) => (
          <div key={i} className="flex flex-col">
            <PageRef n={s.pageNumber} side={side === 'a' ? 'A' : 'B'} />
            <Origin ctx={s.context} />
          </div>
        ))}
        {v.occurrences > v.sources.length && (
          <span className="text-xs text-[var(--muted)]">
            {t('compare.moreOccurrences', { n: v.occurrences - v.sources.length })}
          </span>
        )}
        {v.sourceKind !== 'deterministic' && (
          <Badge tone="warn">{t('analysis.kind.suggested')}</Badge>
        )}
      </div>
    );
  };
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {t(`analysis.type.${f.fieldType}`, { defaultValue: f.fieldType })}
          {f.label ? ` — ${f.label}` : ''}
        </span>
        <Badge tone={f.status === 'igual' ? undefined : 'warn'}>
          {t(`compare.field.${f.status}`)}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {col('a')}
        {col('b')}
      </div>
    </li>
  );
}

function FieldsTab({ result }: { result: ComparisonResult }) {
  const { t } = useTranslation();
  const [showSame, setShowSame] = useState(false);
  const counts: Record<FieldDiffStatus, number> = {
    igual: 0,
    alterado: 0,
    somente_a: 0,
    somente_b: 0,
  };
  for (const f of result.fields) counts[f.status]++;
  const rows = result.fields.filter((f) => showSame || f.status !== 'igual');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">{t('compare.fields.note')}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
        {t('compare.fields.showSame', { n: counts.igual })}
      </label>
      {result.fields.length === 0 && <p className="text-sm">{t('compare.fields.none')}</p>}
      {result.fields.length > 0 && rows.length === 0 && (
        <p className="text-sm">{t('compare.fields.noDiff')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((f, i) => (
          <FieldRow
            key={`${f.fieldType}-${f.label}-${f.a?.normalized}-${f.b?.normalized}-${i}`}
            f={f}
          />
        ))}
      </ul>
    </div>
  );
}

function ClauseRow({ c }: { c: ComparedClause }) {
  const { t } = useTranslation();
  const title =
    c.keyA && c.keyB && c.keyA !== c.keyB ? `${c.keyA} → ${c.keyB}` : (c.keyB ?? c.keyA ?? '');
  return (
    <li className="flex flex-col gap-1 rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{title}</span>
        <Badge tone={c.status === 'igual' ? undefined : 'warn'}>
          {t(`compare.clause.${c.status}`)}
        </Badge>
        {c.needsHumanReview && (
          <Badge tone="warn">{t('analysis.category.exige_revisao_humana')}</Badge>
        )}
        {c.similarity !== null && (
          <span className="text-xs text-[var(--muted)]">
            {t('compare.clauses.similarity', { value: Math.round(c.similarity * 100) })}
          </span>
        )}
        {c.a && <PageRef n={c.a.pageNumber} side="A" />}
        {c.b && <PageRef n={c.b.pageNumber} side="B" />}
      </div>
      {c.status === 'alterada' || c.status === 'renumerada_possivel' ? (
        c.inline ? (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="break-words">
              <Inline parts={c.inline} side="a" />
            </p>
            <p className="break-words">
              <Inline parts={c.inline} side="b" />
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">{t('compare.clauses.noInline')}</p>
        )
      ) : (
        <p className="text-sm break-words text-[var(--muted)]">
          {(c.a ?? c.b)?.text.slice(0, 240)}
          {((c.a ?? c.b)?.text.length ?? 0) > 240 ? '…' : ''}
        </p>
      )}
    </li>
  );
}

function ClausesTab({ result }: { result: ComparisonResult }) {
  const { t } = useTranslation();
  const [showSame, setShowSame] = useState(false);
  const { clauses, stats } = result.clauses;
  const rows = clauses.filter((c) => showSame || c.status !== 'igual');
  return (
    <div className="flex flex-col gap-3">
      <Banner>{t('compare.clauses.note')}</Banner>
      {(result.clauses.duplicateKeysA.length > 0 || result.clauses.duplicateKeysB.length > 0) && (
        <Banner>
          {t('compare.clauses.duplicates', {
            keys: [...result.clauses.duplicateKeysA, ...result.clauses.duplicateKeysB].join(', '),
          })}
        </Banner>
      )}
      {clauses.length === 0 && <p className="text-sm">{t('compare.clauses.none')}</p>}
      {clauses.length > 0 && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showSame}
            onChange={(e) => setShowSame(e.target.checked)}
          />
          {t('compare.clauses.showSame', { n: stats.igual })}
        </label>
      )}
      {clauses.length > 0 && rows.length === 0 && (
        <p className="text-sm">{t('compare.clauses.noDiff')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((c, i) => (
          <ClauseRow key={`${c.keyA}-${c.keyB}-${i}`} c={c} />
        ))}
      </ul>
    </div>
  );
}

function Summary({ result }: { result: ComparisonResult }) {
  const { t } = useTranslation();
  const s = result.text.stats;
  const fieldCounts: Record<FieldDiffStatus, number> = {
    igual: 0,
    alterado: 0,
    somente_a: 0,
    somente_b: 0,
  };
  for (const f of result.fields) fieldCounts[f.status]++;
  const cs = result.clauses.stats;
  const clauseDiffs = (Object.keys(cs) as ClauseDiffStatus[])
    .filter((k) => k !== 'igual')
    .reduce((n, k) => n + cs[k], 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {t('compare.summary.text', {
          similarity: Math.round(result.text.similarity * 100),
          changed: s.changed,
          removed: s.removed,
          added: s.added,
        })}
      </p>
      <p className="text-sm">
        {t('compare.summary.fields', {
          changed: fieldCounts.alterado,
          onlyA: fieldCounts.somente_a,
          onlyB: fieldCounts.somente_b,
          same: fieldCounts.igual,
        })}
      </p>
      <p className="text-sm">
        {t('compare.summary.clauses', {
          diffs: clauseDiffs,
          total: result.clauses.countA + result.clauses.countB,
        })}
      </p>
      {(result.text.truncated.a || result.text.truncated.b) && (
        <Banner>{t('compare.truncated', { n: result.text.unitsA })}</Banner>
      )}
    </div>
  );
}

// ---------- página ----------

export function ComparePage() {
  const { t } = useTranslation();
  const me = useMe();
  const ws = me.data?.workspaces[0]?.id;
  const [params, setParams] = useSearchParams();
  const left: CompareSide = {
    documentId: params.get('ld') ?? '',
    versionId: params.get('lv') ?? '',
  };
  const right: CompareSide = {
    documentId: params.get('rd') ?? '',
    versionId: params.get('rv') ?? '',
  };
  const [tab, setTab] = useState<Tab>('text');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ value: ComparisonResult; a: string; b: string } | null>(
    null,
  );

  const leftDoc = useDocument(ws, left.documentId || undefined);
  const rightDoc = useDocument(ws, right.documentId || undefined);
  const labelOf = (d: typeof leftDoc, versionId: string) => {
    const v = d.data?.versions.find((x) => x.id === versionId);
    return d.data ? `${d.data.document.name} (v${v?.versionNumber ?? '?'})` : '';
  };

  const set = (prefix: 'l' | 'r') => (v: CompareSide) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v.documentId) next.set(`${prefix}d`, v.documentId);
        else next.delete(`${prefix}d`);
        if (v.versionId) next.set(`${prefix}v`, v.versionId);
        else next.delete(`${prefix}v`);
        return next;
      },
      { replace: true },
    );
    setResult(null);
  };

  const same = left.versionId !== '' && left.versionId === right.versionId;
  const ready = Boolean(ws && left.versionId && right.versionId) && !same;

  const run = async () => {
    if (!ws || !ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await loadAndCompare(ws, left, right);
      setResult({
        value,
        a: labelOf(leftDoc, left.versionId),
        b: labelOf(rightDoc, right.versionId),
      });
    } catch (err) {
      setError(err instanceof NoTextError ? `NO_TEXT_${err.side.toUpperCase()}` : errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const exportAs = (format: ExportFormat) => {
    if (!result) return;
    downloadExport(
      result.value,
      format,
      {
        leftLabel: result.a,
        rightLabel: result.b,
        generatedAt: new Date().toISOString(),
        notice: t('compare.notice'),
      },
      {
        section: t('compare.export.section'),
        item: t('compare.export.item'),
        status: t('compare.export.status'),
        valueA: t('compare.export.valueA'),
        originA: t('compare.export.originA'),
        valueB: t('compare.export.valueB'),
        originB: t('compare.export.originB'),
      },
    );
  };

  if (me.isPending) return <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>;
  if (!ws) return <Banner tone="error">{t('errors.NOT_FOUND')}</Banner>;

  return (
    <>
      <Link to="/" className="min-h-11 content-center text-sm underline">
        ← {t('document.back')}
      </Link>
      <Card>
        <h1 className="mb-1 text-xl font-semibold">{t('compare.title')}</h1>
        <p className="mb-3 text-xs text-[var(--muted)]">{t('compare.intro')}</p>
        <Banner>{t('compare.notice')}</Banner>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <SidePicker ws={ws} title={t('compare.sideA')} value={left} onChange={set('l')} />
          <SidePicker ws={ws} title={t('compare.sideB')} value={right} onChange={set('r')} />
        </div>
        {same && (
          <div className="mt-3">
            <Banner>{t('compare.sameVersion')}</Banner>
          </div>
        )}
        <div className="mt-3">
          <Button type="button" onClick={() => void run()} disabled={!ready || busy}>
            {busy ? t('compare.running') : t('compare.run')}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <Banner tone="error">
              {error.startsWith('NO_TEXT_')
                ? t('compare.noText', {
                    side: error.endsWith('A') ? t('compare.sideA') : t('compare.sideB'),
                  })
                : t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
            </Banner>
          </div>
        )}
      </Card>

      {result && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('compare.result')}</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            A: {result.a} · B: {result.b}
          </p>
          <Summary result={result.value} />
          <div className="my-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('compare.export.title')}</span>
            {EXPORT_FORMATS.map((f) => (
              <Button key={f} type="button" onClick={() => exportAs(f)}>
                {f.toUpperCase()}
              </Button>
            ))}
          </div>
          <div
            role="tablist"
            aria-label={t('compare.result')}
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
                {t(`compare.tab.${k}`)}
              </button>
            ))}
          </div>
          {tab === 'text' && <TextTab result={result.value} />}
          {tab === 'fields' && <FieldsTab result={result.value} />}
          {tab === 'clauses' && <ClausesTab result={result.value} />}
        </Card>
      )}
    </>
  );
}
