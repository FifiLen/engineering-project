'use client';

/**
 * FAQ (makieta tresci-faq, ADR 0062): pytania pogrupowane w kategorie w jawnej kolejności, widoczność na stronie
 * i w aplikacji, stan szkic, opublikowane albo archiwum. Kolejność pytań w kategorii zmienia się przeciąganiem albo
 * strzałkami i zapisuje przyciskiem „Zapisz kolejność” (z „Cofnij”), a kolejność kategorii od razu. Edycja pytania
 * w panelu obok listy, z historią i „Przywróć”.
 */
import {
  FAQ_ANSWER_MAX,
  FAQ_CATEGORY_MAX,
  FAQ_QUESTION_MAX,
  parseMarkdown,
  type ContentHistoryEntry,
  type ContentIssueView,
  type ContentStatus,
  type FaqCategoryListItem,
  type FaqItemView,
  type ListResponse,
} from '@hulajnogi/shared';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import {
  AlertIcon,
  ArchiveIcon,
  ArrowDown,
  ArrowUp,
  CloseIcon,
  GlobeIcon,
  GripIcon,
  InfoIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from '../icons';
import {
  apiIssues,
  changedAt,
  ContentHead,
  Counter,
  HistoryList,
  issueMessage,
  StatusPill,
  textLength,
  useContentHistory,
} from './content-common';
import { MarkdownField } from './md-editor';

type Filter = { kind: 'all' } | { kind: 'category'; id: string } | { kind: 'status'; status: 'DRAFT' | 'ARCHIVED' };

interface Data {
  categories: FaqCategoryListItem[];
  items: FaqItemView[];
}

export function FaqPage() {
  const { can } = useSession();
  const canWrite = can('content.write');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  /** Zmieniona, niezapisana kolejność pytań jednej kategorii. */
  const [pending, setPending] = useState<{ categoryId: string; ids: string[] } | null>(null);
  const [rename, setRename] = useState<FaqCategoryListItem | null>(null);
  const [newName, setNewName] = useState('');
  const [removeCategory, setRemoveCategory] = useState<FaqCategoryListItem | null>(null);
  const drag = useRef<{ categoryId: string; index: number } | null>(null);

  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    Promise.all([
      api<ListResponse<FaqCategoryListItem>>('/admin/faq-categories?pageSize=100'),
      api<ListResponse<FaqItemView>>('/admin/faq-items?pageSize=100'),
    ])
      .then(([categories, items]) => setData({ categories: categories.items, items: items.items }))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [revision]);

  const categories = useMemo(() => [...(data?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [data]);
  const itemsOf = useCallback(
    (categoryId: string) => {
      const list = (data?.items ?? [])
        .filter((i) => i.categoryId === categoryId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      if (pending?.categoryId !== categoryId) return list;
      return pending.ids.map((id) => list.find((i) => i.id === id)).filter((i): i is FaqItemView => Boolean(i));
    },
    [data, pending],
  );

  const q = query.trim().toLowerCase();
  const visible = (item: FaqItemView) =>
    (!q || item.question.toLowerCase().includes(q) || item.answerMd.toLowerCase().includes(q)) &&
    (filter.kind !== 'status' || item.status === filter.status);
  const shownCategories = categories.filter((c) => filter.kind !== 'category' || c.id === filter.id);
  const canReorder = canWrite && !q && filter.kind !== 'status';
  const all = data?.items ?? [];

  const moveItem = (categoryId: string, from: number, to: number) => {
    const ids = itemsOf(categoryId).map((i) => i.id);
    if (to < 0 || to >= ids.length || from === to) return;
    if (pending && pending.categoryId !== categoryId) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    setPending({ categoryId, ids });
  };

  async function saveOrder() {
    if (!pending || !data) return;
    const versions = new Map(data.items.map((i) => [i.id, i.version]));
    try {
      await api('/admin/faq-items/order', {
        method: 'PUT',
        json: {
          categoryId: pending.categoryId,
          items: pending.ids.map((id) => ({ id, version: versions.get(id) ?? 1 })),
        },
      });
      setPending(null);
      setNotice(t('content.faq.orderSaved'));
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function moveCategory(index: number, to: number) {
    if (to < 0 || to >= categories.length) return;
    const list = [...categories];
    const [moved] = list.splice(index, 1);
    list.splice(to, 0, moved!);
    try {
      await api('/admin/faq-categories/order', {
        method: 'PUT',
        json: { items: list.map((c) => ({ id: c.id, version: c.version })) },
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function saveName() {
    if (!rename) return;
    try {
      await api(`/admin/faq-categories/${rename.id}`, {
        method: 'PATCH',
        json: { version: rename.version, name: newName.trim() },
      });
      setRename(null);
      reload();
    } catch (e) {
      setError(errorMessage(e));
      setRename(null);
    }
  }

  async function deleteCategory() {
    if (!removeCategory) return;
    try {
      await api(`/admin/faq-categories/${removeCategory.id}?version=${removeCategory.version}`, { method: 'DELETE' });
      if (filter.kind === 'category' && filter.id === removeCategory.id) setFilter({ kind: 'all' });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
    setRemoveCategory(null);
  }

  const grid = '22px 28px minmax(0,1fr) 190px 130px';
  const pendingCategory = pending ? categories.find((c) => c.id === pending.categoryId) : null;
  const selectedItem = selected && selected !== 'new' ? (all.find((i) => i.id === selected) ?? null) : null;

  return (
    <>
      <ContentHead
        actions={
          <>
            <label className="search narrow">
              <SearchIcon />
              <span className="visually-hidden">{t('list.search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('resource.faq-items.searchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {canWrite && (
              <button type="button" className="btn primary" onClick={() => setSelected('new')}>
                <PlusIcon />
                {t('resource.faq-items.new')}
              </button>
            )}
          </>
        }
      />
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <div className="toolbar">
        <button
          type="button"
          className="chip"
          aria-pressed={filter.kind === 'all'}
          onClick={() => setFilter({ kind: 'all' })}
        >
          {t('common.all')}
          <span className="n num">{all.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={filter.kind === 'category' && filter.id === c.id}
            onClick={() => setFilter({ kind: 'category', id: c.id })}
          >
            {c.name}
            <span className="n num">{c.items}</span>
          </button>
        ))}
        <span className="ct-sep" aria-hidden="true" />
        {(['DRAFT', 'ARCHIVED'] as const).map((status) => (
          <button
            key={status}
            type="button"
            className="chip"
            aria-pressed={filter.kind === 'status' && filter.status === status}
            onClick={() => setFilter({ kind: 'status', status })}
          >
            {t.dynamic(`content.statusPlural.${status}`)}
            <span className="n num">{all.filter((i) => i.status === status).length}</span>
          </button>
        ))}
      </div>

      <div className={selected ? 'ct-faq-layout open' : 'ct-faq-layout'}>
        <div className="col">
          <div className="card" style={{ padding: '14px 0 0' }} aria-busy={!data}>
            <div className="table" role="table">
              <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
                <span />
                <span role="columnheader">{t('content.faq.columns.no')}</span>
                <span role="columnheader">{t('resource.faq-items.fields.question')}</span>
                <span role="columnheader">{t('content.faq.columns.visible')}</span>
                <span role="columnheader">{t('resource.faq-items.fields.status')}</span>
              </div>
              {shownCategories.map((category) => {
                const list = itemsOf(category.id);
                const shown = list.filter(visible);
                const index = categories.indexOf(category);
                if (shown.length === 0 && (q || filter.kind === 'status')) return null;
                return (
                  <Fragment key={category.id}>
                    <div className="ct-grp">
                      <b>{category.name}</b>
                      <span>{t('content.faq.questions', { count: category.items })}</span>
                      {canWrite && (
                        <button
                          type="button"
                          className="icon-btn plain sm"
                          aria-label={t('content.faq.rename', { name: category.name })}
                          onClick={() => {
                            setRename(category);
                            setNewName(category.name);
                          }}
                        >
                          <PencilIcon size={13} />
                        </button>
                      )}
                      <span className="grow" />
                      {canWrite && category.items === 0 && (
                        <button type="button" className="link danger-text" onClick={() => setRemoveCategory(category)}>
                          {t('content.faq.deleteCategory')}
                        </button>
                      )}
                      {canWrite && categories.length > 1 && (
                        <span className="ct-catorder">
                          {t('content.faq.categoryOrder')}
                          <button
                            type="button"
                            className="icon-btn plain sm"
                            disabled={index === 0}
                            aria-label={t('content.faq.categoryUp', { name: category.name })}
                            onClick={() => void moveCategory(index, index - 1)}
                          >
                            <ArrowUp />
                          </button>
                          <button
                            type="button"
                            className="icon-btn plain sm"
                            disabled={index === categories.length - 1}
                            aria-label={t('content.faq.categoryDown', { name: category.name })}
                            onClick={() => void moveCategory(index, index + 1)}
                          >
                            <ArrowDown />
                          </button>
                        </span>
                      )}
                    </div>
                    {shown.map((item) => {
                      const position = list.indexOf(item);
                      const draggable = canReorder && (!pending || pending.categoryId === category.id);
                      return (
                        <div
                          key={item.id}
                          role="row"
                          className={item.id === selected ? 'row link-row selected' : 'row link-row'}
                          style={{ gridTemplateColumns: grid }}
                          draggable={draggable}
                          onDragStart={() => {
                            drag.current = { categoryId: category.id, index: position };
                          }}
                          onDragOver={(e) => {
                            if (drag.current?.categoryId === category.id) e.preventDefault();
                          }}
                          onDrop={() => {
                            if (drag.current?.categoryId === category.id)
                              moveItem(category.id, drag.current.index, position);
                            drag.current = null;
                          }}
                          onClick={() => setSelected(item.id)}
                          onKeyDown={(e) => {
                            if (!draggable || !e.altKey) return;
                            if (e.key === 'ArrowUp') moveItem(category.id, position, position - 1);
                            if (e.key === 'ArrowDown') moveItem(category.id, position, position + 1);
                          }}
                          tabIndex={0}
                          aria-label={t('content.faq.rowLabel', { question: item.question })}
                        >
                          <span className="handle" aria-hidden="true">
                            {draggable && <GripIcon size={14} />}
                          </span>
                          <span className="num muted">{position + 1}</span>
                          <span className="strong-500">{item.question}</span>
                          <span className="ct-vis-row">
                            <span className={item.showOnWeb ? 'ct-vis' : 'ct-vis off'}>
                              <GlobeIcon size={12} />
                              {t('content.faq.web')}
                            </span>
                            <span className={item.showInApp ? 'ct-vis' : 'ct-vis off'}>
                              <PhoneIcon size={12} />
                              {t('content.faq.app')}
                            </span>
                          </span>
                          <span className="ct-status">
                            <StatusPill status={item.status} plural={item.status !== 'DRAFT'} />
                            {draggable && (
                              <span className="ct-row-arrows">
                                <button
                                  type="button"
                                  className="icon-btn plain sm"
                                  disabled={position === 0}
                                  aria-label={t('content.editor.moveUp', { position: position + 1 })}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveItem(category.id, position, position - 1);
                                  }}
                                >
                                  <ArrowUp />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn plain sm"
                                  disabled={position === list.length - 1}
                                  aria-label={t('content.editor.moveDown', { position: position + 1 })}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveItem(category.id, position, position + 1);
                                  }}
                                >
                                  <ArrowDown />
                                </button>
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {list.length === 0 && (
                      <div className="row">
                        <span className="small">{t('content.faq.emptyCategory')}</span>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {data && categories.length === 0 && (
                <div className="row">
                  <span className="small">{t('resource.faq-items.emptyBody')}</span>
                </div>
              )}
            </div>
          </div>
          {pending && (
            <div className="ct-orderbar" role="status">
              <InfoIcon size={16} />
              <span className="grow">{t('content.faq.orderChanged', { name: pendingCategory?.name ?? '' })}</span>
              <button type="button" className="ct-orderbar-btn" onClick={() => setPending(null)}>
                {t('content.faq.undo')}
              </button>
              <button type="button" className="btn primary" onClick={() => void saveOrder()}>
                {t('content.faq.saveOrder')}
              </button>
            </div>
          )}
        </div>

        {selected && (
          <FaqEditor
            key={selected}
            item={selectedItem}
            categories={categories}
            defaultCategory={filter.kind === 'category' ? categories.find((c) => c.id === filter.id)?.name : undefined}
            onClose={() => setSelected(null)}
            onSaved={(saved, message) => {
              setNotice(message);
              setSelected(saved?.id ?? null);
              reload();
            }}
          />
        )}
      </div>

      <dialog
        className="confirm"
        ref={(el) => {
          if (!el) return;
          if (rename && !el.open) el.showModal();
          if (!rename && el.open) el.close();
        }}
        onClose={() => setRename(null)}
        aria-labelledby="rename-title"
      >
        <h2 id="rename-title">{t('content.faq.renameTitle')}</h2>
        <div className="dialog-fields">
          <input
            className="input"
            value={newName}
            maxLength={FAQ_CATEGORY_MAX}
            aria-label={t('resource.faq-categories.fields.name')}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setRename(null)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!newName.trim() || newName.trim() === rename?.name}
            onClick={() => void saveName()}
          >
            {t('common.save')}
          </button>
        </div>
      </dialog>
      <ConfirmDialog
        open={removeCategory !== null}
        danger
        title={t('content.faq.deleteCategoryTitle', { name: removeCategory?.name ?? '' })}
        body={t('content.faq.deleteCategoryBody')}
        action={t('content.faq.deleteCategory')}
        onConfirm={() => void deleteCategory()}
        onClose={() => setRemoveCategory(null)}
      />
    </>
  );
}

interface FaqDraft {
  category: string;
  question: string;
  answerMd: string;
  showOnWeb: boolean;
  showInApp: boolean;
}

const toDraft = (item: FaqItemView | null, category = ''): FaqDraft => ({
  category: item?.categoryName ?? category,
  question: item?.question ?? '',
  answerMd: item?.answerMd ?? '',
  showOnWeb: item?.showOnWeb ?? true,
  showInApp: item?.showInApp ?? true,
});

/** Panel „Edycja pytania” (makieta tresci-faq): kategoria istniejąca albo nowa, odpowiedź z podglądem, widoczność. */
function FaqEditor({
  item,
  categories,
  defaultCategory,
  onClose,
  onSaved,
}: {
  item: FaqItemView | null;
  categories: FaqCategoryListItem[];
  defaultCategory?: string;
  onClose: () => void;
  onSaved: (item: FaqItemView | null, message: string) => void;
}) {
  const { can } = useSession();
  const readOnly = !can('content.write');
  const [draft, setDraft] = useState<FaqDraft>(() => toDraft(item, defaultCategory ?? categories[0]?.name ?? ''));
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const [issues, setIssues] = useState<ContentIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const history = useContentHistory(item ? `/admin/faq-items/${item.id}/history` : null, item?.version);
  const set = (patch: Partial<FaqDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const answerIssues = parseMarkdown(draft.answerMd, 'faq').issues.length > 0;
  const tooLong = textLength(draft.question) > FAQ_QUESTION_MAX || textLength(draft.answerMd) > FAQ_ANSWER_MAX;
  const noClient = !draft.showOnWeb && !draft.showInApp;
  const incomplete = !draft.category.trim() || !draft.question.trim() || !draft.answerMd.trim();
  const blocked = answerIssues || tooLong || noClient || incomplete;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(toDraft(item, draft.category)) || restoredFrom !== null || !item;
  const categoryCount = categories.find((c) => c.name.toLowerCase() === draft.category.trim().toLowerCase())?.items;

  async function save(status: ContentStatus) {
    setBusy(true);
    setError(null);
    try {
      const body = {
        category: draft.category.trim(),
        question: draft.question.trim(),
        answerMd: draft.answerMd,
        showOnWeb: draft.showOnWeb,
        showInApp: draft.showInApp,
        status,
      };
      const saved = item
        ? await api<FaqItemView>(`/admin/faq-items/${item.id}`, {
            method: 'PATCH',
            json: { ...body, version: item.version, restoredFrom },
          })
        : await api<FaqItemView>('/admin/faq-items', { method: 'POST', json: body });
      setRestoredFrom(null);
      setIssues([]);
      setDraft(toDraft(saved));
      onSaved(saved, t.dynamic(`content.faq.saved.${status}`));
    } catch (e) {
      setIssues(apiIssues(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    setConfirmDelete(false);
    try {
      await api(`/admin/faq-items/${item.id}?version=${item.version}`, { method: 'DELETE' });
      onSaved(null, t('content.faq.deleted'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const restore = (entry: ContentHistoryEntry) => {
    const after = entry.after ?? {};
    const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
    setDraft({
      category: text(after.categoryName, draft.category),
      question: text(after.question, draft.question),
      answerMd: text(after.answerMd, draft.answerMd),
      showOnWeb: typeof after.showOnWeb === 'boolean' ? after.showOnWeb : draft.showOnWeb,
      showInApp: typeof after.showInApp === 'boolean' ? after.showInApp : draft.showInApp,
    });
    setRestoredFrom(entry.auditId);
    setShowHistory(false);
  };

  const status = item?.status ?? 'DRAFT';
  return (
    <aside className="card ct-panel" aria-label={t('content.faq.editTitle')}>
      <div className="ct-panel-head">
        <h2>{item ? t('content.faq.editTitle') : t('content.faq.newTitle')}</h2>
        <StatusPill status={status} />
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="ct-panel-body">
        {error && <Banner kind="danger">{error}</Banner>}
        <label className="field">
          <span className="label">{t('resource.faq-items.fields.categoryName')}</span>
          <span className="ct-input-affix">
            <input
              className="input"
              list="faq-categories"
              value={draft.category}
              readOnly={readOnly}
              maxLength={FAQ_CATEGORY_MAX}
              onChange={(e) => set({ category: e.target.value })}
            />
            {categoryCount !== undefined && (
              <span className="small">{t('content.faq.questions', { count: categoryCount })}</span>
            )}
          </span>
          <datalist id="faq-categories">
            {categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <span className="hint">
            {categoryCount === undefined && draft.category.trim()
              ? t('content.faq.newCategory', { name: draft.category.trim() })
              : t('content.faq.categoryHint')}
          </span>
        </label>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="faq-question">
              {t('resource.faq-items.fields.question')}
            </label>
            <Counter value={textLength(draft.question)} max={FAQ_QUESTION_MAX} />
          </div>
          <input
            id="faq-question"
            className="input"
            value={draft.question}
            readOnly={readOnly}
            onChange={(e) => set({ question: e.target.value })}
          />
        </div>
        <MarkdownField
          id="faq-answer"
          label={t('resource.faq-items.fields.answerMd')}
          labelNote={t('content.editor.markdown')}
          value={draft.answerMd}
          onChange={(answerMd) => set({ answerMd })}
          profile="faq"
          max={FAQ_ANSWER_MAX}
          readOnly={readOnly}
          layout="toggle"
          serverIssues={issues.filter((i) => i.field === 'answerMd')}
        />
        <div className="field">
          <span className="label">{t('content.faq.where')}</span>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={draft.showOnWeb}
              disabled={readOnly}
              onChange={(e) => set({ showOnWeb: e.target.checked })}
            />
            {t('content.faq.whereWeb')}
          </label>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={draft.showInApp}
              disabled={readOnly}
              onChange={(e) => set({ showInApp: e.target.checked })}
            />
            {t('content.faq.whereApp')}
          </label>
          {noClient && (
            <span className="err ct-line">
              <AlertIcon size={14} />
              {t('content.issues.FAQ_NO_CLIENT')}
            </span>
          )}
        </div>
        {issues
          .filter((i) => i.field !== 'answerMd')
          .map((issue, i) => (
            <span key={i} className="err ct-line">
              <AlertIcon size={14} />
              {issueMessage(issue)}
            </span>
          ))}
        {showHistory && (
          <div className="ct-panel-history">
            <HistoryList entries={history} canRestore={!readOnly} onRestore={restore} />
          </div>
        )}
      </div>
      <div className="ct-panel-meta">
        <span className="small">
          {item
            ? t('content.faq.meta', {
                version: item.version,
                name: item.updatedByName ?? t('content.history.seed'),
                when: changedAt(item.updatedAt),
              })
            : t('content.faq.newMeta')}
          {restoredFrom !== null && ` · ${t('content.history.restoredPending')}`}
        </span>
        {item && (
          <button type="button" className="link" onClick={() => setShowHistory((v) => !v)}>
            {t('content.faq.history', { count: history?.length ?? 0 })}
          </button>
        )}
      </div>
      {!readOnly && (
        <div className="ct-panel-foot">
          {item && status !== 'ARCHIVED' && (
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => void save('ARCHIVED')}>
              <ArchiveIcon size={15} />
              {t('content.actions.archive')}
            </button>
          )}
          {item && status !== 'PUBLISHED' && (
            <button
              type="button"
              className="btn danger"
              aria-label={t('content.actions.delete')}
              title={t('content.actions.delete')}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={15} />
            </button>
          )}
          <span className="grow" />
          {status === 'PUBLISHED' ? (
            <>
              <button type="button" className="btn" disabled={busy || blocked} onClick={() => void save('DRAFT')}>
                {t('content.actions.unpublish')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || blocked || !dirty}
                onClick={() => void save('PUBLISHED')}
              >
                {t('common.save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy || blocked || (!dirty && status === 'DRAFT')}
                onClick={() => void save('DRAFT')}
              >
                {t('content.actions.saveDraft')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || blocked}
                onClick={() => void save('PUBLISHED')}
              >
                {t('content.actions.publish')}
              </button>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('content.faq.deleteTitle')}
        body={t('content.faq.deleteBody')}
        action={t('content.actions.delete')}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </aside>
  );
}
