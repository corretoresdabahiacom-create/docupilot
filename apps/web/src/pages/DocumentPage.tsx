import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AnalysisCard } from '../components/AnalysisCard';
import { OcrPanel } from '../components/OcrPanel';
import { PdfPreview } from '../components/preview/PdfPreview';
import { TextPreview } from '../components/preview/TextPreview';
import { UploadForm } from '../components/UploadForm';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError, type DocumentDetail } from '../lib/api';
import { fetchDocumentBlob, getDownloadInfo } from '../lib/documents';
import { folderPaths } from '../lib/folders';
import { formatBytes, formatDate } from '../lib/format';
import {
  canDeleteRole,
  canEditRole,
  useDocument,
  useFolders,
  useHealth,
  useMe,
} from '../lib/queries';
import { runExtraction } from '../lib/upload';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isImage = (mime: string) => mime === 'image/png' || mime === 'image/jpeg';

function ErrorBanner({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <Banner tone="error">{t(`errors.${code}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
  );
}

function ExtractionCard({
  workspaceId,
  detail,
  sizeBytes,
  canEdit,
}: {
  workspaceId: string;
  detail: DocumentDetail;
  sizeBytes: number;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { document: doc, metadata, versions } = detail;
  const versionId = doc.currentVersionId;
  const current = versions.find((v) => v.id === versionId);

  const extract = async () => {
    if (!versionId || !current) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetchDocumentBlob(workspaceId, doc.id, versionId);
      await runExtraction(workspaceId, { documentId: doc.id, versionId, mime: doc.mime }, blob);
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const partialOcr =
    metadata?.extractedBy === 'client_ocr' &&
    metadata.pageKind === 'page' &&
    (metadata.pageCount ?? 0) > detail.lastStoredPage;

  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('extraction.title')}</h2>
      <p className="mb-2 text-sm font-medium">{t(`documents.status.${doc.status}`)}</p>

      {doc.status === 'extracted' && metadata && (
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          <li>
            {t(metadata.pageKind === 'page' ? 'extraction.pages' : 'extraction.sections', {
              n: metadata.pageCount ?? detail.pagesStored,
            })}
          </li>
          <li>{t('extraction.chars', { n: metadata.textCharCount ?? 0 })}</li>
          <li className="text-[var(--muted)]">
            {t(metadata.extractedBy === 'client_ocr' ? 'extraction.byOcr' : 'extraction.byText')}
          </li>
        </ul>
      )}
      {doc.status === 'needs_text' && <p className="mb-2 text-sm">{t('extraction.pending')}</p>}
      {doc.status === 'extraction_failed' && (
        <p className="mb-2 text-sm">{t('extraction.failed')}</p>
      )}
      {doc.status === 'needs_ocr' && <p className="mb-2 text-sm">{t('extraction.needsOcr')}</p>}

      {canEdit && (doc.status === 'needs_text' || doc.status === 'extraction_failed') && (
        <Button type="button" onClick={() => void extract()} disabled={busy}>
          {busy
            ? t('extraction.running')
            : doc.status === 'needs_text'
              ? t('extraction.run')
              : t('extraction.retry')}
        </Button>
      )}
      <ErrorBanner code={error} />

      {canEdit && versionId && (doc.status === 'needs_ocr' || partialOcr) && (
        <div className="mt-3">
          <OcrPanel
            workspaceId={workspaceId}
            documentId={doc.id}
            versionId={versionId}
            mime={doc.mime}
            sizeBytes={sizeBytes}
            startFrom={doc.status === 'needs_ocr' ? 1 : detail.lastStoredPage + 1}
          />
        </div>
      )}
    </Card>
  );
}

function PreviewCard({ workspaceId, detail }: { workspaceId: string; detail: DocumentDetail }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { document: doc, metadata } = detail;
  const versionId = doc.currentVersionId;
  const visual = doc.mime === 'application/pdf' || isImage(doc.mime);
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const [tab, setTab] = useState<'original' | 'text'>(visual ? 'original' : 'text');
  const kind = metadata?.pageKind ?? (doc.mime === 'application/pdf' ? 'page' : 'section');

  const download = useQuery({
    queryKey: ['download', workspaceId, doc.id, versionId],
    queryFn: () => getDownloadInfo(workspaceId, doc.id, versionId ?? undefined),
    enabled: visual && tab === 'original' && Boolean(versionId),
    staleTime: 10 * 60 * 1000,
  });

  if (!versionId) return null;
  const setPage = (n: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(n));
    setParams(next, { replace: true });
  };

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('preview.title')}</h2>
        {visual && (
          <div role="tablist" className="flex gap-1">
            {(['original', 'text'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`min-h-11 rounded-md border px-3 text-sm ${tab === k ? 'border-[var(--primary)] font-semibold' : 'border-[var(--border)]'}`}
              >
                {t(`preview.tab.${k}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'original' && visual && (
        <>
          {download.isPending && (
            <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>
          )}
          {download.isError && <ErrorBanner code={errorKey(download.error)} />}
          {download.data && doc.mime === 'application/pdf' && (
            <PdfPreview url={download.data.url} page={page} onPageChange={setPage} />
          )}
          {download.data && isImage(doc.mime) && (
            <img
              src={download.data.url}
              alt={doc.name}
              className="max-h-[70vh] max-w-full rounded-md border border-[var(--border)]"
            />
          )}
        </>
      )}

      {tab === 'text' && (
        <>
          {doc.mime === DOCX && (
            <p className="mb-2 text-xs text-[var(--muted)]">{t('preview.docxNote')}</p>
          )}
          {detail.pagesStored === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t('preview.noText')}</p>
          ) : (
            <TextPreview
              key={`${versionId}-${page}`}
              workspaceId={workspaceId}
              documentId={doc.id}
              versionId={versionId}
              startPage={page}
              kind={kind}
            />
          )}
        </>
      )}
    </Card>
  );
}

export function DocumentPage() {
  const { t, i18n } = useTranslation();
  const { documentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const health = useHealth();
  const workspace = me.data?.workspaces[0];
  const ws = workspace?.id;
  const detail = useDocument(ws, documentId);
  const folders = useFolders(ws);
  const canEdit = canEditRole(workspace?.role);
  const canDelete = canDeleteRole(workspace?.role);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries();
  const patch = useMutation({
    mutationFn: (body: { name?: string; folderId?: string | null }) =>
      api(`/workspaces/${ws}/documents/${documentId}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      setError(null);
      setName(null);
      await refresh();
    },
    onError: (e) => setError(errorKey(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/workspaces/${ws}/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      navigate('/');
    },
    onError: (e) => setError(errorKey(e)),
  });
  const setCurrent = useMutation({
    mutationFn: (versionId: string) =>
      api(`/workspaces/${ws}/documents/${documentId}/versions/${versionId}/current`, {
        method: 'POST',
      }),
    onSuccess: refresh,
    onError: (e) => setError(errorKey(e)),
  });
  const removeVersion = useMutation({
    mutationFn: (versionId: string) =>
      api(`/workspaces/${ws}/documents/${documentId}/versions/${versionId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setError(errorKey(e)),
  });

  const download = async (versionId?: string) => {
    if (!ws || !documentId) return;
    try {
      const info = await getDownloadInfo(ws, documentId, versionId);
      window.open(info.url, '_blank', 'noopener');
    } catch (err) {
      setError(errorKey(err));
    }
  };

  if (detail.isPending) return <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>;
  if (detail.isError || !detail.data || !ws) {
    return (
      <Card>
        <Banner tone="error">{t('errors.NOT_FOUND')}</Banner>
        <Link to="/" className="mt-2 inline-block underline">
          {t('document.back')}
        </Link>
      </Card>
    );
  }

  const d = detail.data;
  const doc = d.document;
  const paths = folderPaths(folders.data?.folders ?? []);
  const currentVersion = d.versions.find((v) => v.id === doc.currentVersionId);
  const submitName = (e: FormEvent) => {
    e.preventDefault();
    if (name && name.trim() && name !== doc.name) patch.mutate({ name: name.trim() });
  };

  return (
    <>
      <Link
        to={doc.folderId ? `/?folder=${doc.folderId}` : '/'}
        className="min-h-11 content-center text-sm underline"
      >
        ← {t('document.back')}
      </Link>

      <Card>
        <h1 className="mb-1 text-xl font-semibold break-all">{doc.name}</h1>
        <p className="mb-3 text-xs text-[var(--muted)]">
          {doc.mime} · {formatBytes(currentVersion?.sizeBytes)} ·{' '}
          {t('document.updated', { date: formatDate(doc.updatedAt, i18n.language) })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void download()}>
            {t('document.download')}
          </Button>
          {currentVersion && (
            <Link
              to={`/compare?ld=${doc.id}&lv=${
                d.versions.find((v) => v.id !== doc.currentVersionId)?.id ?? currentVersion.id
              }&rd=${doc.id}&rv=${currentVersion.id}`}
              className="inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium"
            >
              {d.versions.length > 1 ? t('compare.versions') : t('compare.withOther')}
            </Link>
          )}
          {doc.mime === 'application/pdf' && (
            <Link
              to={`/documents/${doc.id}/fill`}
              className="inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium"
            >
              {t('fill.link')}
            </Link>
          )}
          {canDelete && (
            <Button
              type="button"
              danger
              onClick={() => {
                if (window.confirm(t('document.confirmDelete', { name: doc.name })))
                  remove.mutate();
              }}
            >
              {t('common.delete')}
            </Button>
          )}
        </div>
        <ErrorBanner code={error} />

        {canEdit && (
          <div className="mt-4 flex flex-col gap-3">
            <form onSubmit={submitName} className="flex flex-wrap items-end gap-2">
              <Field
                id="doc-name"
                label={t('document.rename')}
                value={name ?? doc.name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" disabled={patch.isPending || !name || name === doc.name}>
                {t('common.save')}
              </Button>
            </form>
            <div className="flex flex-col gap-1">
              <label htmlFor="doc-folder" className="text-sm font-medium">
                {t('document.moveTo')}
              </label>
              <select
                id="doc-folder"
                value={doc.folderId ?? ''}
                onChange={(e) => patch.mutate({ folderId: e.target.value || null })}
                className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              >
                <option value="">{t('documents.title')}</option>
                {[...paths.entries()].map(([id, path]) => (
                  <option key={id} value={id}>
                    {path}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Card>

      <ExtractionCard
        workspaceId={ws}
        detail={d}
        sizeBytes={currentVersion?.sizeBytes ?? 0}
        canEdit={canEdit}
      />
      {doc.status === 'extracted' && (
        <AnalysisCard
          workspaceId={ws}
          documentId={doc.id}
          versionId={doc.currentVersionId}
          mime={doc.mime}
          canEdit={canEdit}
        />
      )}
      <PreviewCard workspaceId={ws} detail={d} />

      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t('versions.title')}</h2>
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {d.versions.map((v) => {
            const isCurrent = v.id === doc.currentVersionId;
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="text-sm">
                  <span className="font-medium">
                    {t('versions.number', { n: v.versionNumber })}
                  </span>
                  {isCurrent && (
                    <span className="ml-2 rounded bg-[var(--warn-bg)] px-1.5 text-xs text-[var(--warn-text)]">
                      {t('versions.current')}
                    </span>
                  )}
                  <div className="text-xs text-[var(--muted)]">
                    {formatDate(v.createdAt, i18n.language)} · {formatBytes(v.sizeBytes)} · SHA-256{' '}
                    {v.sha256.slice(0, 12)}…
                  </div>
                </div>
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="min-h-11 px-2 text-sm underline"
                    onClick={() => void download(v.id)}
                  >
                    {t('document.download')}
                  </button>
                  {canEdit && !isCurrent && (
                    <button
                      type="button"
                      className="min-h-11 px-2 text-sm underline"
                      onClick={() => setCurrent.mutate(v.id)}
                    >
                      {t('versions.makeCurrent')}
                    </button>
                  )}
                  {canDelete && !isCurrent && (
                    <button
                      type="button"
                      className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
                      onClick={() => {
                        if (window.confirm(t('versions.confirmDelete', { n: v.versionNumber })))
                          removeVersion.mutate(v.id);
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {canEdit && (
        <UploadForm
          workspaceId={ws}
          documentId={doc.id}
          storageReady={health.data?.storage.configured === true}
        />
      )}
    </>
  );
}
