'use client';

/**
 * Zakładka Szablony (ADR 0067, makieta wydruki-szablony): szablony według rodzaju z aktywną wersją, liczbą pól
 * aktywnej wersji, szablonem domyślnym i liczbą wydruków z 30 dni; rodzaje bez szablonu z „Wgraj szablon”.
 * Zmiany (`templates.write`, Administrator): nowy szablon, domyślny. „Instrukcja i lista pól” pokazuje katalog
 * pól z API, bez kopii w panelu.
 */
import {
  type DocumentTemplateListItem,
  type DocumentTemplateVersionView,
  type DocumentTemplateView,
  type ListResponse,
  type TemplateDocumentType,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { CloseIcon, DocumentIcon, MoreIcon, PlusIcon, QrIcon, StarIcon, UploadIcon } from '../icons';
import { FieldCatalog, FieldsDocxButton, useFieldCatalog } from './field-catalog';
import {
  invalidateDocumentTypes,
  PrintsHead,
  PrintsTabs,
  PRINTS_PATHS,
  TEMPLATE_TYPE_ORDER,
  typeName,
  useModal,
} from './prints-common';

/** Szczegóły szablonu z wersjami (`GET /admin/document-templates/{id}`). */
export interface TemplateDetails extends DocumentTemplateView {
  active: boolean;
  versions: DocumentTemplateVersionView[];
}

interface Row {
  item: DocumentTemplateListItem;
  activeVersion: DocumentTemplateVersionView | null;
  pendingNo: number | null;
  prints30: number | null;
}

const DAY_MS = 86_400_000;

/** Autor i data wersji: „Piotr Mazur, 14 lis”, wersja z seeda to „dane startowe”. */
export const versionAuthor = (v: DocumentTemplateVersionView) =>
  t('prints.templates.versionBy', {
    name: v.createdByName ?? t('prints.templates.starter'),
    date: formatDate(v.activatedAt ?? v.createdAt),
  });

export function TemplatesPage() {
  const router = useRouter();
  const { can } = useSession();
  const readable = can('templates.read');
  const write = can('templates.write');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState<TemplateDocumentType | '' | null>(null);
  const [guide, setGuide] = useState(false);
  const [since] = useState(() => new Date(Date.now() - 30 * DAY_MS).toISOString());

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
      // Pola aktywnej wersji i wersja do aktywacji są w szczegółach; wydruki z 30 dni z listy Wygenerowane.
      const enriched = await Promise.all(
        list.items.map(async (item): Promise<Row> => {
          const [details, prints] = await Promise.all([
            api<TemplateDetails>(`/admin/document-templates/${item.id}`, { signal }).catch(() => null),
            can('documents.generate')
              ? api<ListResponse<unknown>>(
                  `/admin/generated-documents?templateId=${item.id}&createdAt.gte=${encodeURIComponent(since)}&pageSize=10`,
                  { signal },
                )
                  .then((r) => r.total)
                  .catch(() => null)
              : Promise.resolve(null),
          ]);
          const pending = details?.versions.filter((v) => v.state === 'PENDING') ?? [];
          return {
            item,
            activeVersion: details?.versions.find((v) => v.state === 'ACTIVE') ?? null,
            pendingNo: pending.length ? Math.max(...pending.map((v) => v.versionNo)) : null,
            prints30: prints,
          };
        }),
      );
      setRows(enriched);
      setError(null);
    })().catch((e: unknown) => {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
    });
    return () => controller.abort();
  }, [readable, can, since, revision]);

  const setDefault = async (id: string) => {
    try {
      await api(`/admin/document-templates/${id}/default`, { method: 'POST' });
      invalidateDocumentTypes();
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!readable) return null;
  const grid = 'minmax(0,1fr) 210px 70px 150px 110px 32px';

  return (
    <>
      <PrintsHead
        actions={
          <>
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
      {error && <Banner kind="danger">{error}</Banner>}

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
              const own = rows.filter((r) => r.item.documentType === type);
              return (
                <Fragment key={type}>
                  <div className="pr-grp" role="row">
                    <span className="pr-grp-name">{typeName(type)}</span>
                    <span className="code">{type}</span>
                    <span className="pr-grp-from">{t.dynamic(`prints.types.${type}.from`)}</span>
                  </div>
                  {own.length === 0 && (
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
                    <TemplateRow key={row.item.id} row={row} grid={grid} write={write} onDefault={setDefault} />
                  ))}
                </Fragment>
              );
            })}
        </div>
      </section>
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
  onDefault,
}: {
  row: Row;
  grid: string;
  write: boolean;
  onDefault: (id: string) => void;
}) {
  const router = useRouter();
  const { item, activeVersion, pendingNo, prints30 } = row;
  const href = PRINTS_PATHS.template(item.id);
  return (
    <div
      className="row link-row pr-trow"
      role="row"
      style={{ gridTemplateColumns: grid }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a,button')) router.push(href);
      }}
    >
      <span role="cell" className="stack">
        <Link href={href} className="strong pr-plain-link">
          {item.name}
        </Link>
        {item.description && <span className="small">{item.description}</span>}
      </span>
      <span role="cell" className="stack">
        {item.activeVersionNo !== null ? (
          <span className="pr-ver">
            <span className="num">{t('prints.templates.version', { version: item.activeVersionNo })}</span>
            {pendingNo !== null && (
              <span className="pill warn sm">{t('prints.templates.pending', { version: pendingNo })}</span>
            )}
          </span>
        ) : (
          <span className="pr-ver">
            <span className="muted">{t('prints.templates.noActive')}</span>
            {pendingNo !== null && (
              <span className="pill warn sm">{t('prints.templates.pending', { version: pendingNo })}</span>
            )}
          </span>
        )}
        {activeVersion && <span className="small">{versionAuthor(activeVersion)}</span>}
      </span>
      <span role="cell" className="num">
        {activeVersion ? activeVersion.fields.length : t('common.none')}
      </span>
      <span role="cell">
        {item.isDefault ? (
          <span className="pr-star">
            <StarIcon />
            {t('prints.templates.default')}
          </span>
        ) : write && item.activeVersionNo !== null ? (
          <button type="button" className="link pr-link-btn" onClick={() => onDefault(item.id)}>
            {t('prints.templates.setDefault')}
          </button>
        ) : (
          <span className="muted">{t('common.none')}</span>
        )}
      </span>
      <span role="cell" className="num">
        {prints30 ?? t('common.none')}
      </span>
      <span role="cell">
        <Link href={href} className="icon-btn plain" aria-label={t('prints.templates.open', { name: item.name })}>
          <MoreIcon size={16} />
        </Link>
      </span>
    </div>
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
