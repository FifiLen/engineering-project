'use client';

/**
 * Zakładka Szablony (ADR 0067, makieta wydruki-szablony): szablony według rodzaju z aktywną wersją, liczbą pól
 * aktywnej wersji, szablonem domyślnym i liczbą wydruków z 30 dni; rodzaje bez szablonu z „Wgraj szablon”.
 * Zmiany (`templates.write`, Administrator): nowy szablon, domyślny, a od iteracji 8 (ADR 0076, makieta
 * wydruki-szablon-edycja) edycja nazwy i opisu z blokadą optymistyczną (`TEMPLATE_NAME_TAKEN`), dezaktywacja
 * z potwierdzeniem (domyślny z aktywną wersją zablokowany, `TEMPLATE_IS_DEFAULT`) i „Aktywuj ponownie”; szybkie
 * filtry Aktywne i Nieaktywne oraz eksport listy. „Instrukcja i lista pól” pokazuje katalog pól z API.
 */
import {
  documentTemplatesResource,
  type DocumentTemplateListItem,
  type DocumentTemplateVersionView,
  type DocumentTemplateView,
  type ListResponse,
  type TemplateDocumentType,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api, apiBlob, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import {
  CloseIcon,
  DocumentIcon,
  DownloadIcon,
  LockIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  QrIcon,
  RestoreIcon,
  SearchIcon,
  StarIcon,
  UploadIcon,
} from '../icons';
import { ExportButton } from '../list-export';
import { FieldCatalog, FieldsDocxButton, useFieldCatalog } from './field-catalog';
import {
  invalidateDocumentTypes,
  PrintsHead,
  PrintsTabs,
  PRINTS_PATHS,
  saveBlob,
  TEMPLATE_TYPE_ORDER,
  typeName,
  useModal,
} from './prints-common';

/** Szczegóły szablonu z wersjami (`GET /admin/document-templates/{id}`); `version` do blokady optymistycznej. */
export interface TemplateDetails extends DocumentTemplateView {
  active: boolean;
  version: number;
  versions: DocumentTemplateVersionView[];
}

interface Row {
  item: DocumentTemplateListItem;
  activeVersion: DocumentTemplateVersionView | null;
  pendingNo: number | null;
}

type ActivityFilter = 'all' | 'active' | 'inactive';

/** Panel boczny: edycja nazwy i opisu albo potwierdzenie dezaktywacji (makieta wydruki-szablon-edycja). */
type Panel = { item: DocumentTemplateListItem; confirm: boolean } | null;

/** Autor i data wersji: „Piotr Mazur, 14 lis”, wersja z seeda to „dane startowe”. */
export const versionAuthor = (v: DocumentTemplateVersionView) =>
  t('prints.templates.versionBy', {
    name: v.createdByName ?? t('prints.templates.starter'),
    date: formatDate(v.activatedAt ?? v.createdAt),
  });

/** Domyślny szablon z aktywną wersją nie może zniknąć z „Drukuj” (`409 TEMPLATE_IS_DEFAULT`). */
const lockedDefault = (item: DocumentTemplateListItem) => item.isDefault && item.activeVersionNo !== null;

const TEMPLATE_EXPORT_COLUMNS = [
  'documentType',
  'name',
  'description',
  'active',
  'isDefault',
  'activeVersionNo',
  'activeSince',
  'activeFields',
  'versions',
  'pendingVersions',
  'generated30d',
  'lastGeneratedAt',
  'deactivatedAt',
  'updatedByName',
] as const;

export function TemplatesPage() {
  const router = useRouter();
  const { can } = useSession();
  const readable = can('templates.read');
  const write = can('templates.write');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState<TemplateDocumentType | '' | null>(null);
  const [guide, setGuide] = useState(false);
  const [activity, setActivity] = useState<ActivityFilter>('all');
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Panel>(null);

  // Bez `templates.read` pozycja „Wydruki” prowadzi do Wygenerowanych.
  useEffect(() => {
    if (!readable) router.replace(PRINTS_PATHS.generated);
  }, [readable, router]);

  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const list = await api<ListResponse<DocumentTemplateListItem>>('/admin/document-templates?pageSize=100', {
        signal,
      });
      // Autor aktywnej wersji i wersja do aktywacji są w szczegółach; pola, wydruki z 30 dni i dezaktywacja na liście.
      const enriched = await Promise.all(
        list.items.map(async (item): Promise<Row> => {
          const details = await api<TemplateDetails>(`/admin/document-templates/${item.id}`, { signal }).catch(
            () => null,
          );
          const pending = details?.versions.filter((v) => v.state === 'PENDING') ?? [];
          return {
            item,
            activeVersion: details?.versions.find((v) => v.state === 'ACTIVE') ?? null,
            pendingNo: pending.length ? Math.max(...pending.map((v) => v.versionNo)) : null,
          };
        }),
      );
      setRows(enriched);
      setError(null);
    })().catch((e: unknown) => {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
    });
    return () => controller.abort();
  }, [readable, revision]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      invalidateDocumentTypes();
      setRevision((n) => n + 1);
      setNotice(done);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  const setDefault = (item: DocumentTemplateListItem) =>
    void run(
      () => api(`/admin/document-templates/${item.id}/default`, { method: 'POST' }),
      t('templateEdit.defaultDone', { name: item.name }),
    );
  const reactivate = (item: DocumentTemplateListItem) =>
    void run(
      () => api(`/admin/document-templates/${item.id}/reactivate`, { method: 'POST' }),
      t('templateEdit.reactivated', { name: item.name }),
    );
  const deactivate = async (item: DocumentTemplateListItem) => {
    const done = await run(
      () => api(`/admin/document-templates/${item.id}/deactivate`, { method: 'POST' }),
      t('templateEdit.deactivated', { name: item.name }),
    );
    if (done) setPanel(null);
  };

  if (!readable) return null;
  // Z panelem edycji obok tabeli kolumny są węższe, żeby nazwa szablonu została czytelna.
  const grid = panel ? 'minmax(0,1fr) 120px 40px 120px 60px 36px' : 'minmax(0,1fr) 200px 60px 170px 100px 40px';
  const needle = search.trim().toLowerCase();
  const visible = (rows ?? []).filter(
    (r) =>
      (activity === 'all' || (activity === 'active') === r.item.active) &&
      (!needle || `${r.item.name} ${r.item.description ?? ''}`.toLowerCase().includes(needle)),
  );
  const count = (a: ActivityFilter) =>
    (rows ?? []).filter((r) => a === 'all' || (a === 'active') === r.item.active).length;
  const exportQuery: Record<string, string> = {
    ...(activity !== 'all' ? { active: String(activity === 'active') } : {}),
    ...(needle ? { q: search.trim() } : {}),
  };

  return (
    <>
      <PrintsHead
        actions={
          <>
            <label className="search">
              <SearchIcon />
              <span className="visually-hidden">{t('list.search')}</span>
              <input
                type="search"
                value={search}
                placeholder={t('resource.document-templates.searchPlaceholder')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button type="button" className="btn" onClick={() => setGuide(true)}>
              <DocumentIcon size={16} />
              {t('prints.templates.guide')}
            </button>
            {write && (
              <button type="button" className="btn primary" onClick={() => setCreating('')}>
                <PlusIcon size={16} />
                {t('prints.templates.new')}
              </button>
            )}
          </>
        }
      />
      <PrintsTabs revision={revision} />
      <div className="toolbar">
        {(['all', 'active', 'inactive'] as const).map((a) => (
          <button key={a} type="button" className="chip" aria-pressed={activity === a} onClick={() => setActivity(a)}>
            {t.dynamic(`templateEdit.quick.${a}`)}
            <span className="n num">{count(a)}</span>
          </button>
        ))}
        <span className="spacer" />
        <ExportButton
          resource={documentTemplatesResource}
          params={exportQuery}
          rows={rows ? visible.length : null}
          filters={
            activity === 'all'
              ? []
              : [
                  `${t('resource.document-templates.fields.active')}: ${t.dynamic(`templateEdit.quick.${activity}`)}`,
                ]
          }
          search={needle ? search.trim() : undefined}
          sort={t('templateEdit.sort')}
          columns={TEMPLATE_EXPORT_COLUMNS}
          onDone={(file) => setNotice(t('listExport.done', { file }))}
          disabled={!rows}
        />
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <div className={panel ? 'te-layout with-panel' : 'te-layout'}>
        <section className="card pr-table" aria-busy={rows === null}>
          <div className="table" role="table" aria-label={t('prints.tabs.templates')}>
            <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
              <span role="columnheader">{t('prints.templates.columns.template')}</span>
              <span role="columnheader">{t('prints.templates.columns.activeVersion')}</span>
              <span role="columnheader">{t('prints.templates.columns.fields')}</span>
              <span role="columnheader">{t('prints.templates.columns.default')}</span>
              <span role="columnheader">{t('prints.templates.columns.prints30')}</span>
              <span role="columnheader" />
            </div>
            {rows === null && !error && <div className="row" aria-busy="true" />}
            {rows &&
              TEMPLATE_TYPE_ORDER.map((type) => {
                const own = visible.filter((r) => r.item.documentType === type);
                const any = rows.some((r) => r.item.documentType === type);
                // Przy filtrze albo wyszukiwaniu rodzaje bez pasujących szablonów znikają.
                if (own.length === 0 && (any || activity !== 'all' || needle)) return null;
                return (
                  <Fragment key={type}>
                    <div className="pr-grp" role="row">
                      <span className="pr-grp-name">{typeName(type)}</span>
                      <span className="code">{type}</span>
                      <span className="pr-grp-from">{t.dynamic(`prints.types.${type}.from`)}</span>
                    </div>
                    {!any && (
                      <div className="pr-missing" role="row">
                        <span>{t.dynamic(`prints.types.${type}.missing`)}</span>
                        {write && (
                          <button type="button" className="link pr-link-btn" onClick={() => setCreating(type)}>
                            <UploadIcon size={14} />
                            {t('prints.templates.upload')}
                          </button>
                        )}
                      </div>
                    )}
                    {own.map((row) => (
                      <TemplateRow
                        key={row.item.id}
                        row={row}
                        grid={grid}
                        write={write}
                        selected={panel?.item.id === row.item.id}
                        onDefault={setDefault}
                        onReactivate={reactivate}
                        onEdit={(item) => setPanel({ item, confirm: false })}
                        onDeactivate={(item) => setPanel({ item, confirm: true })}
                        onError={setError}
                      />
                    ))}
                  </Fragment>
                );
              })}
          </div>
          {rows && (
            <div className="pager">
              <span className="num">{t('templateEdit.summary', { count: visible.length })}</span>
            </div>
          )}
        </section>
        {panel && (
          <TemplateEditPanel
            key={`${panel.item.id}:${panel.item.version}`}
            item={panel.item}
            confirm={panel.confirm}
            onConfirm={(confirm) => setPanel({ item: panel.item, confirm })}
            onClose={() => setPanel(null)}
            onSaved={(name) => {
              setPanel(null);
              invalidateDocumentTypes();
              setRevision((n) => n + 1);
              setNotice(t('templateEdit.saved', { name }));
            }}
            onDeactivate={() => void deactivate(panel.item)}
          />
        )}
      </div>
      <p className="pr-note small">
        <QrIcon size={15} />
        {t('prints.templates.labelNote')}
      </p>

      {creating !== null && (
        <NewTemplateDialog
          initialType={creating || null}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            invalidateDocumentTypes();
            router.push(PRINTS_PATHS.template(id));
          }}
        />
      )}
      {guide && <FieldGuideDialog onClose={() => setGuide(false)} />}
    </>
  );
}

function TemplateRow({
  row,
  grid,
  write,
  selected,
  onDefault,
  onReactivate,
  onEdit,
  onDeactivate,
  onError,
}: {
  row: Row;
  grid: string;
  write: boolean;
  selected: boolean;
  onDefault: (item: DocumentTemplateListItem) => void;
  onReactivate: (item: DocumentTemplateListItem) => void;
  onEdit: (item: DocumentTemplateListItem) => void;
  onDeactivate: (item: DocumentTemplateListItem) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const { item, activeVersion, pendingNo } = row;
  const href = PRINTS_PATHS.template(item.id);
  const inactive = !item.active;
  const pending = pendingNo !== null && (
    <span className="pill warn sm">{t('prints.templates.pending', { version: pendingNo })}</span>
  );
  return (
    <div
      className={['row link-row pr-trow', inactive && 'te-inactive', selected && 'selected'].filter(Boolean).join(' ')}
      role="row"
      style={{ gridTemplateColumns: grid }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a,button,[role="menu"]')) router.push(href);
      }}
    >
      <span role="cell" className="stack">
        <span className="te-name">
          <Link href={href} className="strong pr-plain-link">
            {item.name}
          </Link>
          {inactive && <span className="pill muted sm">{t('templateEdit.inactive')}</span>}
        </span>
        {item.description && <span className="small">{item.description}</span>}
      </span>
      <span role="cell" className="stack">
        <span className="pr-ver">
          {item.activeVersionNo !== null ? (
            <span className="num">{t('prints.templates.version', { version: item.activeVersionNo })}</span>
          ) : (
            <span className="muted">{t('prints.templates.noActive')}</span>
          )}
          {pending}
        </span>
        {inactive && item.deactivatedAt ? (
          <span className="small">{t('templateEdit.deactivatedOn', { date: formatDate(item.deactivatedAt) })}</span>
        ) : (
          activeVersion && <span className="small">{versionAuthor(activeVersion)}</span>
        )}
      </span>
      <span role="cell" className="num">
        {item.activeVersionNo !== null ? item.activeFields : t('common.none')}
      </span>
      <span role="cell">
        {inactive ? (
          write ? (
            <button type="button" className="link pr-link-btn" onClick={() => onReactivate(item)}>
              {t('templateEdit.reactivate')}
            </button>
          ) : (
            <span className="muted">{t('templateEdit.inactive')}</span>
          )
        ) : item.isDefault ? (
          <span className="pr-star">
            <StarIcon />
            {t('prints.templates.default')}
          </span>
        ) : write && item.activeVersionNo !== null ? (
          <button type="button" className="link pr-link-btn" onClick={() => onDefault(item)}>
            {t('prints.templates.setDefault')}
          </button>
        ) : (
          <span className="muted">{t('common.none')}</span>
        )}
      </span>
      <span role="cell" className="num">
        {item.generated30d}
      </span>
      <span role="cell">
        <TemplateMenu
          item={item}
          activeVersion={activeVersion}
          write={write}
          onEdit={() => onEdit(item)}
          onDeactivate={() => onDeactivate(item)}
          onReactivate={() => onReactivate(item)}
          onError={onError}
        />
      </span>
    </div>
  );
}

/** Ikona dezaktywacji (włącznik) z makiety. */
function PowerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 3v8" strokeLinecap="round" />
      <path d="M6.3 7.2a8 8 0 1 0 11.4 0" strokeLinecap="round" />
    </svg>
  );
}

/** Menu „…” wiersza: edycja, nowa wersja, pobranie aktywnej wersji i dezaktywacja (zablokowana dla domyślnego). */
function TemplateMenu(props: {
  item: DocumentTemplateListItem;
  activeVersion: DocumentTemplateVersionView | null;
  write: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onError: (message: string) => void;
}) {
  const { item, activeVersion, write } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const download = async () => {
    if (!activeVersion) return;
    try {
      const blob = await apiBlob(`/admin/document-templates/${item.id}/versions/${activeVersion.id}/file`);
      saveBlob(blob, activeVersion.fileName ?? `${item.name}-v${activeVersion.versionNo}.docx`);
    } catch (e) {
      props.onError(errorMessage(e));
    }
  };
  const locked = lockedDefault(item);
  return (
    <span className="te-menu-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn plain"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('prints.templates.open', { name: item.name })}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon size={16} />
      </button>
      {open && (
        <span className="te-menu" role="menu">
          {write && (
            <button type="button" role="menuitem" onClick={pick(props.onEdit)}>
              <PencilIcon size={16} />
              {t('templateEdit.menu.edit')}
            </button>
          )}
          {write && (
            <Link role="menuitem" href={PRINTS_PATHS.template(item.id)} onClick={() => setOpen(false)}>
              <UploadIcon size={16} />
              {t('templateEdit.menu.upload')}
            </Link>
          )}
          <button type="button" role="menuitem" disabled={!activeVersion} onClick={pick(() => void download())}>
            <DownloadIcon size={16} />
            {t('templateEdit.menu.download')}
          </button>
          {write && <span className="te-menu-sep" role="separator" />}
          {write && !item.active && (
            <button type="button" role="menuitem" onClick={pick(props.onReactivate)}>
              <RestoreIcon />
              {t('templateEdit.reactivate')}
            </button>
          )}
          {write && item.active && (
            <button
              type="button"
              role="menuitem"
              className={locked ? 'te-locked' : 'danger'}
              disabled={locked}
              onClick={pick(props.onDeactivate)}
            >
              {locked ? <LockIcon size={16} /> : <PowerIcon />}
              <span className="stack">
                <span>{t('templateEdit.menu.deactivate')}</span>
                {locked && <small>{t('templateEdit.lockedDefault', { type: typeName(item.documentType) })}</small>}
              </span>
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/** „Edytuj szablon”: nazwa (unikalna w rodzaju) i opis z wersją rekordu; sekcja dezaktywacji z potwierdzeniem. */
function TemplateEditPanel(props: {
  item: DocumentTemplateListItem;
  confirm: boolean;
  onConfirm: (confirm: boolean) => void;
  onClose: () => void;
  onSaved: (name: string) => void;
  onDeactivate: () => void;
}) {
  const { item } = props;
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changes = {
    ...(name.trim() !== item.name ? { name: name.trim() } : {}),
    ...(description.trim() !== (item.description ?? '') ? { description: description.trim() || null } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const locked = lockedDefault(item);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNameError(null);
    try {
      await api(`/admin/document-templates/${item.id}`, { method: 'PATCH', json: { version: item.version, ...changes } });
      props.onSaved(name.trim());
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'TEMPLATE_NAME_TAKEN') setNameError(errorMessage(e));
      else setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <aside className="card te-panel" aria-labelledby="te-title">
      <div className="te-panel-head">
        <div className="stack">
          <h2 id="te-title">{t('templateEdit.title')}</h2>
          <span className="small">{typeName(item.documentType)}</span>
        </div>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="te-panel-body">
        <label className="field">
          <span className="label">{t('resource.document-templates.fields.name')}</span>
          <input
            className={nameError ? 'input error' : 'input'}
            value={name}
            maxLength={120}
            disabled={busy}
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError ? (
            <span className="err" role="alert">
              {nameError}
            </span>
          ) : (
            <span className="hint">{t('templateEdit.nameHint', { name: item.name })}</span>
          )}
        </label>
        <label className="field">
          <span className="label">
            {t('resource.document-templates.fields.description')} <span className="opt">{t('common.optional')}</span>
          </span>
          <input
            className="input"
            value={description}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && (
          <span className="err" role="alert">
            {error}
          </span>
        )}
        <div className="te-actions">
          <button type="button" className="btn" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !dirty || !name.trim()}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      {item.active && (
        <div className="te-deactivate">
          <h3>{t('templateEdit.deactivation')}</h3>
          {locked ? (
            <div className="notice info">
              <span className="ic" aria-hidden="true">
                <LockIcon size={14} />
              </span>
              <span>{t('templateEdit.lockedDefault', { type: typeName(item.documentType) })}</span>
            </div>
          ) : props.confirm ? (
            <div className="te-confirm" role="alertdialog" aria-labelledby="te-confirm-title">
              <div className="end-head">
                <span className="end-icon" aria-hidden="true">
                  <PowerIcon />
                </span>
                <h4 id="te-confirm-title">{t('templateEdit.confirmTitle', { name: item.name })}</h4>
              </div>
              <div className="te-effects">
                <span>
                  <DocumentIcon size={14} />
                  {t('templateEdit.effectPrint', { count: item.generated30d })}
                </span>
                <span>
                  <RestoreIcon />
                  {t('templateEdit.effectRestore')}
                </span>
              </div>
              <div className="te-actions">
                <button type="button" className="btn" onClick={() => props.onConfirm(false)}>
                  {t('templateEdit.keepActive')}
                </button>
                <button type="button" className="btn solid-danger" onClick={props.onDeactivate}>
                  {t('templateEdit.deactivate')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="small">{t('templateEdit.deactivateHint')}</p>
              <button type="button" className="btn danger" onClick={() => props.onConfirm(true)}>
                <PowerIcon />
                {t('templateEdit.deactivate')}
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

/** „Nowy szablon” i „Wgraj szablon”: rodzaj z katalogu, nazwa i opis; wersję wgrywa się na karcie szablonu. */
function NewTemplateDialog({
  initialType,
  onClose,
  onCreated,
}: {
  initialType: TemplateDocumentType | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const ref = useModal();
  const [type, setType] = useState<TemplateDocumentType>(initialType ?? 'RECEIPT');
  const [name, setName] = useState(initialType ? typeName(initialType) : '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<TemplateDetails>('/admin/document-templates', {
        method: 'POST',
        json: { documentType: type, name: name.trim(), description: description.trim() || null },
      });
      onCreated(created.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="pr-dialog" onClose={onClose} aria-labelledby="new-template-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <PlusIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="new-template-title">{t('prints.templates.newTitle')}</h2>
          <p>{t('prints.templates.newSub')}</p>
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <label className="field">
        <span className="label">{t('resource.document-templates.fields.documentType')}</span>
        <select
          className="input"
          value={type}
          onChange={(e) => setType(e.target.value as TemplateDocumentType)}
          disabled={initialType !== null}
        >
          {TEMPLATE_TYPE_ORDER.map((value) => (
            <option key={value} value={value}>
              {typeName(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">{t('resource.document-templates.fields.name')}</span>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">
          {t('resource.document-templates.fields.description')} <span className="opt">{t('common.optional')}</span>
        </span>
        <textarea
          className="input"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span className="hint">{t('prints.templates.descriptionHint')}</span>
      </label>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="actions pr-dlg-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          {t('common.create')}
        </button>
      </div>
    </dialog>
  );
}

/** „Instrukcja i lista pól”: zasady znaczników i katalog pól wybranego rodzaju z API. */
function FieldGuideDialog({ onClose }: { onClose: () => void }) {
  const ref = useModal();
  const [type, setType] = useState<TemplateDocumentType>('SERVICE_PROTOCOL');
  const catalog = useFieldCatalog(type);
  const [error, setError] = useState<string | null>(null);
  return (
    <dialog ref={ref} className="pr-dialog wide" onClose={onClose} aria-labelledby="guide-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <DocumentIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="guide-title">{t('prints.guide.title')}</h2>
          <p>{t('prints.guide.sub')}</p>
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <ul className="pr-rules">
        <li>
          <span className="pr-tag">{t('prints.guide.fieldTag')}</span>
          {t('prints.guide.field')}
        </li>
        <li>
          <span className="pr-tag">{t('prints.guide.loopTag')}</span>
          {t('prints.guide.loop')}
        </li>
        <li>
          <span className="pr-tag">{t('prints.guide.conditionTag')}</span>
          {t('prints.guide.condition')}
        </li>
        <li>{t('prints.guide.rules')}</li>
      </ul>
      <div className="pr-guide-bar">
        <select
          className="select"
          value={type}
          aria-label={t('resource.document-templates.fields.documentType')}
          onChange={(e) => setType(e.target.value as TemplateDocumentType)}
        >
          {TEMPLATE_TYPE_ORDER.map((value) => (
            <option key={value} value={value}>
              {typeName(value)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <FieldsDocxButton type={type} onError={setError} />
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="pr-guide-list">{catalog ? <FieldCatalog catalog={catalog} /> : <div aria-busy="true" />}</div>
    </dialog>
  );
}
