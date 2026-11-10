import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Snippet } from '../components/Snippet';
import { UploadForm } from '../components/UploadForm';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError, type FolderRow } from '../lib/api';
import { formatBytes } from '../lib/format';
import { breadcrumb } from '../lib/folders';
import {
  canDeleteRole,
  canEditRole,
  useDocuments,
  useFolders,
  useHealth,
  useMe,
  useSearch,
} from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');

function FolderRowItem({
  folder,
  workspaceId,
  canEdit,
  canDelete,
  onOpen,
}: {
  folder: FolderRow;
  workspaceId: string;
  canEdit: boolean;
  canDelete: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: () =>
      api(`/workspaces/${workspaceId}/folders/${folder.id}`, { method: 'PATCH', body: { name } }),
    onSuccess: async () => {
      setEditing(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['folders', workspaceId] });
    },
    onError: (e) => setError(errorKey(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/workspaces/${workspaceId}/folders/${folder.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders', workspaceId] }),
    onError: (e) => setError(errorKey(e)),
  });

  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editing ? (
          <form
            className="flex flex-1 flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <Field
              id={`rename-${folder.id}`}
              label={t('folders.name')}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={rename.isPending}>
              {t('common.save')}
            </Button>
            <Button type="button" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="min-h-11 text-left font-medium underline-offset-2 hover:underline"
          >
            📁 {folder.name}
          </button>
        )}
        {!editing && (
          <span className="flex gap-2">
            {canEdit && (
              <button
                type="button"
                className="min-h-11 px-2 text-sm underline"
                onClick={() => setEditing(true)}
              >
                {t('folders.rename')}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-[var(--danger)] underline"
                onClick={() => {
                  if (window.confirm(t('folders.confirmDelete', { name: folder.name })))
                    remove.mutate();
                }}
              >
                {t('common.delete')}
              </button>
            )}
          </span>
        )}
      </div>
      {error && (
        <Banner tone="error">{t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}</Banner>
      )}
    </li>
  );
}

function NewFolderForm({
  workspaceId,
  parentId,
}: {
  workspaceId: string;
  parentId: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api(`/workspaces/${workspaceId}/folders`, { method: 'POST', body: { name, parentId } }),
    onSuccess: async () => {
      setName('');
      setError(null);
      await qc.invalidateQueries({ queryKey: ['folders', workspaceId] });
    },
    onError: (e) => setError(errorKey(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field
        id="new-folder"
        label={t('folders.new')}
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {t('folders.create')}
      </Button>
      {error && (
        <div className="w-full">
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        </div>
      )}
    </form>
  );
}

function SearchResults({ workspaceId, q }: { workspaceId: string; q: string }) {
  const { t } = useTranslation();
  const search = useSearch(workspaceId, q);
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">{t('search.results', { q })}</h2>
      {search.isPending && <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>}
      {search.isError && (
        <Banner tone="error">
          {t(`errors.${errorKey(search.error)}`, { defaultValue: t('errors.INTERNAL') })}
        </Banner>
      )}
      {search.data && search.data.mode === 'like' && <Banner>{t('search.likeMode')}</Banner>}
      {search.data && search.data.results.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t('search.none')}</p>
      )}
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {search.data?.results.map((r) => (
          <li key={`${r.documentId}-${r.pageNumber}`} className="flex flex-col gap-1 py-3">
            <Link
              to={`/documents/${r.documentId}?page=${r.pageNumber}`}
              className="font-medium break-all underline-offset-2 hover:underline"
            >
              {r.documentName}
            </Link>
            <span className="text-xs text-[var(--muted)]">
              {t(r.pageKind === 'page' ? 'preview.page' : 'preview.section', { n: r.pageNumber })}
            </span>
            <Snippet value={r.snippet} />
          </li>
        ))}
      </ul>
      {search.data?.hasMore && (
        <p className="mt-2 text-xs text-[var(--muted)]">{t('search.hasMore')}</p>
      )}
    </Card>
  );
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const health = useHealth();
  const [params, setParams] = useSearchParams();
  const workspace = me.data?.workspaces[0];
  const folderId = params.get('folder');
  const q = params.get('q')?.trim() ?? '';
  const [draft, setDraft] = useState(q);
  const folders = useFolders(workspace?.id);
  const docs = useDocuments(workspace?.id, folderId);
  const canEdit = canEditRole(workspace?.role);
  const canDelete = canDeleteRole(workspace?.role);

  const allFolders = folders.data?.folders ?? [];
  const chain = breadcrumb(allFolders, folderId);
  const children = allFolders.filter((f) => f.parentId === folderId);

  const open = (id: string | null) => {
    const next = new URLSearchParams();
    if (id) next.set('folder', id);
    setParams(next);
    setDraft('');
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (draft.trim().length >= 2) next.set('q', draft.trim());
    else next.delete('q');
    setParams(next);
  };

  return (
    <>
      {workspace && canEdit && (
        <UploadForm
          workspaceId={workspace.id}
          folderId={folderId}
          storageReady={health.data?.storage.configured === true}
        />
      )}

      <Card>
        <p className="mb-2 text-xs text-[var(--muted)]">{t('search.disclaimer')}</p>
        <form onSubmit={submitSearch} role="search" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              id="search"
              type="search"
              label={t('search.label')}
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <Button type="submit">{t('search.button')}</Button>
          {q && (
            <Button
              type="button"
              onClick={() => {
                setDraft('');
                const next = new URLSearchParams(params);
                next.delete('q');
                setParams(next);
              }}
            >
              {t('search.clear')}
            </Button>
          )}
        </form>
      </Card>

      {q && workspace ? (
        <SearchResults workspaceId={workspace.id} q={q} />
      ) : (
        <Card>
          <nav
            aria-label={t('folders.breadcrumb')}
            className="mb-3 flex flex-wrap items-center gap-1 text-sm"
          >
            <button type="button" className="min-h-11 underline" onClick={() => open(null)}>
              {t('documents.title')}
            </button>
            {chain.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <button type="button" className="min-h-11 underline" onClick={() => open(f.id)}>
                  {f.name}
                </button>
              </span>
            ))}
          </nav>

          {workspace && canEdit && (
            <div className="mb-3">
              <NewFolderForm workspaceId={workspace.id} parentId={folderId} />
            </div>
          )}

          {workspace && children.length > 0 && (
            <ul className="mb-2 flex flex-col divide-y divide-[var(--border)]">
              {children.map((f) => (
                <FolderRowItem
                  key={f.id}
                  folder={f}
                  workspaceId={workspace.id}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onOpen={() => open(f.id)}
                />
              ))}
            </ul>
          )}

          {docs.data?.documents.length === 0 && children.length === 0 && (
            <p className="text-sm text-[var(--muted)]">{t('documents.empty')}</p>
          )}
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {docs.data?.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  to={`/documents/${d.id}`}
                  className="min-h-11 content-center break-all underline-offset-2 hover:underline"
                >
                  {d.name}
                </Link>
                <span className="text-xs text-[var(--muted)]">
                  {formatBytes(d.sizeBytes)} · {t(`documents.status.${d.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
