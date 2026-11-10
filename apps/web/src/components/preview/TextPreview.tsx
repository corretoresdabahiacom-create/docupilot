import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Banner, Button } from '../ui';

interface PagesResponse {
  pages: { pageNumber: number; text: string }[];
  hasMore: boolean;
}

/** Texto extraído, por página/seção. React escapa tudo: o conteúdo nunca vira HTML. */
export function TextPreview({
  workspaceId,
  documentId,
  versionId,
  startPage = 1,
  kind,
}: {
  workspaceId: string;
  documentId: string;
  versionId: string;
  startPage?: number;
  kind: 'page' | 'section';
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ['pages', workspaceId, documentId, versionId, startPage],
    initialPageParam: startPage,
    queryFn: ({ pageParam }) =>
      api<PagesResponse>(
        `/workspaces/${workspaceId}/documents/${documentId}/pages?versionId=${versionId}&from=${pageParam}`,
      ),
    getNextPageParam: (last) =>
      last.hasMore && last.pages.length > 0
        ? last.pages[last.pages.length - 1]!.pageNumber + 1
        : undefined,
  });

  if (query.isPending) return <p className="text-sm text-[var(--muted)]">{t('common.loading')}</p>;
  if (query.isError) return <Banner tone="error">{t('errors.INTERNAL')}</Banner>;
  const pages = query.data.pages.flatMap((p) => p.pages);
  if (pages.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t('preview.noText')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {pages.map((p) => (
        <section key={p.pageNumber} aria-label={`${kind} ${p.pageNumber}`}>
          <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">
            {t(kind === 'page' ? 'preview.page' : 'preview.section', { n: p.pageNumber })}
          </h3>
          <pre className="font-sans text-sm break-words whitespace-pre-wrap">{p.text}</pre>
        </section>
      ))}
      {query.hasNextPage && (
        <Button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t('preview.loadMore')}
        </Button>
      )}
    </div>
  );
}
