import { useQueryClient } from '@tanstack/react-query';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router';
import {
  DOC_EXPORT_FORMATS,
  findPlaceholders,
  safeHref,
  validateDoc,
  type DocExportFormat,
  type DocRoot,
} from '@docupilot/shared';
import { Banner, Button, Card } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useGeneratedDoc, useWorkspace } from '../lib/creation';
import { exportDocument } from '../lib/docExport';
import { saveBlob } from '../lib/fill';
import { canEditRole } from '../lib/queries';

const errorKey = (err: unknown) => (err instanceof ApiError ? err.code : 'INTERNAL');
const MAX_IMAGE_BYTES = 400 * 1024;

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 text-sm disabled:opacity-40 ${
        active ? 'bg-[var(--primary)] text-[var(--primary-text)]' : 'bg-[var(--surface)]'
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onError }: { editor: Editor; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');
  const file = useRef<HTMLInputElement>(null);
  const run = () => editor.chain().focus();

  const applyLink = () => {
    const safe = safeHref(href.trim());
    if (!safe) {
      onError(t('editor.linkInvalid'));
      return;
    }
    run().extendMarkRange('link').setLink({ href: safe }).run();
    setLinkOpen(false);
  };

  const addImage = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|gif)$/.test(f.type)) return onError(t('editor.imageType'));
    if (f.size > MAX_IMAGE_BYTES) return onError(t('editor.imageSize'));
    const reader = new FileReader();
    reader.onload = () =>
      run()
        .setImage({ src: String(reader.result), alt: f.name })
        .run();
    reader.readAsDataURL(f);
  };

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar')}
      className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
    >
      <Tool
        label={t('editor.bold')}
        active={editor.isActive('bold')}
        onClick={() => run().toggleBold().run()}
      >
        <b>B</b>
      </Tool>
      <Tool
        label={t('editor.italic')}
        active={editor.isActive('italic')}
        onClick={() => run().toggleItalic().run()}
      >
        <i>I</i>
      </Tool>
      <Tool
        label={t('editor.strike')}
        active={editor.isActive('strike')}
        onClick={() => run().toggleStrike().run()}
      >
        <s>S</s>
      </Tool>
      {([1, 2, 3] as const).map((level) => (
        <Tool
          key={level}
          label={t('editor.heading', { level })}
          active={editor.isActive('heading', { level })}
          onClick={() => run().toggleHeading({ level }).run()}
        >
          H{level}
        </Tool>
      ))}
      <Tool
        label={t('editor.bullets')}
        active={editor.isActive('bulletList')}
        onClick={() => run().toggleBulletList().run()}
      >
        •
      </Tool>
      <Tool
        label={t('editor.numbers')}
        active={editor.isActive('orderedList')}
        onClick={() => run().toggleOrderedList().run()}
      >
        1.
      </Tool>
      <Tool
        label={t('editor.quote')}
        active={editor.isActive('blockquote')}
        onClick={() => run().toggleBlockquote().run()}
      >
        ❝
      </Tool>
      <Tool label={t('editor.rule')} onClick={() => run().setHorizontalRule().run()}>
        —
      </Tool>
      <Tool
        label={t('editor.link')}
        active={editor.isActive('link')}
        onClick={() => setLinkOpen((v) => !v)}
      >
        🔗
      </Tool>
      <Tool
        label={t('editor.table')}
        onClick={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        ▦
      </Tool>
      {editor.isActive('table') && (
        <>
          <Tool label={t('editor.addRow')} onClick={() => run().addRowAfter().run()}>
            +↓
          </Tool>
          <Tool label={t('editor.addCol')} onClick={() => run().addColumnAfter().run()}>
            +→
          </Tool>
          <Tool label={t('editor.delTable')} onClick={() => run().deleteTable().run()}>
            ✕▦
          </Tool>
        </>
      )}
      <Tool label={t('editor.image')} onClick={() => file.current?.click()}>
        🖼
      </Tool>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="sr-only"
        aria-label={t('editor.image')}
        onChange={(e) => {
          addImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Tool
        label={t('editor.undo')}
        disabled={!editor.can().undo()}
        onClick={() => run().undo().run()}
      >
        ↶
      </Tool>
      <Tool
        label={t('editor.redo')}
        disabled={!editor.can().redo()}
        onClick={() => run().redo().run()}
      >
        ↷
      </Tool>
      {linkOpen && (
        <div className="flex w-full items-center gap-2 pt-1">
          <label className="sr-only" htmlFor="link-href">
            {t('editor.linkUrl')}
          </label>
          <input
            id="link-href"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            className="min-h-11 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3"
          />
          <Button type="button" onClick={applyLink}>
            {t('editor.apply')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              run().unsetLink().run();
              setLinkOpen(false);
            }}
            className="bg-transparent !text-[var(--text)] border border-[var(--border)]"
          >
            {t('editor.removeLink')}
          </Button>
        </div>
      )}
    </div>
  );
}

function EditorBody({ id, ws, role }: { id: string; ws: string; role: string | undefined }) {
  const { t, i18n } = useTranslation();
  const q = useGeneratedDoc(ws, id);
  const qc = useQueryClient();
  const canEdit = canEditRole(role);
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const loaded = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['http', 'https', 'mailto'],
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
    editable: canEdit,
    editorProps: { attributes: { 'aria-label': t('editor.area'), class: 'tiptap-doc' } },
    onUpdate: ({ editor: e }) => {
      setDirty(true);
      setMissing(findPlaceholders(e.getJSON() as DocRoot));
    },
  });

  useEffect(() => {
    if (!editor || !q.data || loaded.current) return;
    loaded.current = true;
    setTitle(q.data.title);
    setVersion(q.data.version);
    editor.commands.setContent(q.data.content, false);
    setMissing(q.data.placeholders);
  }, [editor, q.data]);

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (q.isPending) return <p>{t('common.loading')}</p>;
  if (q.isError || !editor) return <Banner tone="error">{t('errors.NOT_FOUND')}</Banner>;

  /** O que vai para o servidor/arquivo é sempre o documento já saneado pelo mesmo validador. */
  const current = (): DocRoot | null => {
    const r = validateDoc(editor.getJSON());
    if (!r.ok) {
      setNotice({ tone: 'error', text: t('editor.invalidDoc') });
      return null;
    }
    return r.doc;
  };

  const save = async () => {
    const content = current();
    if (!content) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<{ version: number }>(`/workspaces/${ws}/generated/${id}`, {
        method: 'PUT',
        body: { title: title.trim() || t('create.untitled'), content, version },
      });
      setVersion(r.version);
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['generated', ws] });
      setNotice({ tone: 'warn', text: t('editor.saved') });
    } catch (err) {
      const code = errorKey(err);
      setNotice({
        tone: 'error',
        text:
          code === 'CONFLICT'
            ? t('editor.conflict')
            : t(`errors.${code}`, { defaultValue: t('errors.INTERNAL') }),
      });
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (format: DocExportFormat) => {
    const content = current();
    if (!content) return;
    setBusy(true);
    setNotice(null);
    try {
      // 1) o servidor autoriza e conta a cota; 2) só então o arquivo é gerado, aqui no navegador.
      await api(`/workspaces/${ws}/generated/${id}/exports`, { method: 'POST', body: { format } });
      const out = await exportDocument(
        content,
        title || t('create.untitled'),
        format,
        i18n.language.startsWith('en') ? 'en' : 'pt',
      );
      saveBlob(out.bytes, out.fileName, out.mime);
      const extra = missing.length
        ? ` ${t('editor.exportMissing', { count: missing.length })}`
        : '';
      const warn = out.warnings.length ? ` ${out.warnings.join(' ')}` : '';
      setNotice({
        tone: 'warn',
        text: `${t('editor.exported', { name: out.fileName })}${warn}${extra}`,
      });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: t(`errors.${errorKey(err)}`, { defaultValue: t('errors.INTERNAL') }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <RouterLink to="/create" className="min-h-11 content-center text-sm underline">
        ← {t('create.title')}
      </RouterLink>
      <div className="flex flex-col gap-1">
        <label htmlFor="doc-title" className="text-sm font-medium">
          {t('create.docTitle')}
        </label>
        <input
          id="doc-title"
          value={title}
          readOnly={!canEdit}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
        />
      </div>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {!canEdit && <Banner>{t('editor.readOnly')}</Banner>}
      {missing.length > 0 && (
        <Banner>
          {t('editor.missing', {
            count: missing.length,
            fields: missing.map((m) => `{{${m}}}`).join(', '),
          })}
        </Banner>
      )}
      <Card className="flex flex-col gap-2">
        {canEdit && (
          <Toolbar editor={editor} onError={(text) => setNotice({ tone: 'error', text })} />
        )}
        <EditorContent editor={editor} />
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        )}
        <span className="text-xs text-[var(--muted)]">
          {dirty ? t('editor.unsaved') : t('editor.upToDate', { version })}
        </span>
      </div>
      <Card className="flex flex-col gap-2">
        <h2 className="font-medium">{t('editor.exportTitle')}</h2>
        <p className="text-xs text-[var(--muted)]">{t('editor.exportHint')}</p>
        <div className="flex flex-wrap gap-2">
          {DOC_EXPORT_FORMATS.map((f) => (
            <Button key={f} type="button" disabled={busy} onClick={() => void doExport(f)}>
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  if (!ws.id || !id) return null;
  return <EditorBody key={id} id={id} ws={ws.id} role={ws.role} />;
}
