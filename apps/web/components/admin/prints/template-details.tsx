'use client';

/**
 * Szablon wydruku (ADR 0067, makiety wydruki-szablon-wersja i wydruki-wgranie-bledy): wersje ze stanem
 * (Do aktywacji, Aktywna, Archiwalna), wynik walidacji wybranej wersji z ostrzeżeniami o nieużytych polach,
 * podgląd PDF na danych przykładowych (`preview.pdf`, osadzony z pamięci, bo punkt wymaga tokenu) i pola wersji.
 * Wgranie wersji (`multipart/form-data`) z błędami `422 TEMPLATE_INVALID` w oknie z miejscem w dokumencie (tabela,
 * wiersz, kolumna albo akapit; bez numeru strony) i podpowiedzią. Aktywacja, „Przywróć”, domyślny i usunięcie
 * wersji „Do aktywacji” tylko z `templates.write`.
 */
import type {
  DocumentFieldCatalogView,
  DocumentFileLink,
  DocumentTemplateVersionView,
  TemplateDocumentType,
  TemplateIssueDetails,
  TemplatePlace,
  TemplateWarningDetails,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, apiBlob, ApiRequestError, errorMessage, fileUrl } from '../../../lib/api';
import { formatClock, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import {
  AlertIcon,
  CheckIcon,
  DocumentIcon,
  DownloadIcon,
  InfoIcon,
  StarIcon,
  UploadIcon,
  WarningIcon,
} from '../icons';
import { FieldCatalog, FieldsDocxButton, useFieldCatalog } from './field-catalog';
import { formatSize, invalidateDocumentTypes, PRINTS_PATHS, saveBlob, typeName, useModal } from './prints-common';
import { versionAuthor, type TemplateDetails } from './templates';

const STATE_PILL = { PENDING: 'pill warn', ACTIVE: 'pill accent', ARCHIVED: 'pill muted' } as const;

/** Problem wgrania: lista z API (`TEMPLATE_INVALID`) albo jeden kod pliku (typ, rozmiar, makra). */
interface UploadFailure {
  fileName: string;
  sizeBytes: number;
  at: string;
  issues: Array<TemplateIssueDetails & { reason?: string }>;
  /** Kod błędu pliku bez listy znaczników (np. `TEMPLATE_MACROS`). */
  code: string | null;
}

export function TemplateDetailsPage({ id }: { id: string }) {
  const { can } = useSession();
  const write = can('templates.write');
  const [template, setTemplate] = useState<TemplateDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'fields'>('preview');
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'restore' | 'delete'; version: DocumentTemplateVersionView } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (select?: string) =>
      api<TemplateDetails>(`/admin/document-templates/${id}`)
        .then((details) => {
          setTemplate(details);
          if (select) setSelectedId(select);
        })
        .catch((e: unknown) => setError(errorMessage(e))),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const catalog = useFieldCatalog(template?.documentType ?? null);

  if (!template) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;

  const versions = [...template.versions].sort((a, b) => b.versionNo - a.versionNo);
  const active = versions.find((v) => v.state === 'ACTIVE') ?? null;
  const fallback = versions.find((v) => v.state === 'PENDING') ?? active ?? versions[0] ?? null;
  const selected = versions.find((v) => v.id === selectedId) ?? fallback;

  const pickFile = () => {
    if (fileInput.current) fileInput.current.value = '';
    fileInput.current?.click();
  };

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      invalidateDocumentTypes();
      if (message) setNotice(message);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const activate = (version: DocumentTemplateVersionView) =>
    run(
      async () => {
        setTemplate(
          await api<TemplateDetails>(`/admin/document-templates/${id}/versions/${version.id}/activate`, {
            method: 'POST',
          }),
        );
      },
      t(version.state === 'ARCHIVED' ? 'prints.version.restored' : 'prints.version.activated', {
        version: version.versionNo,
      }),
    );

  const setDefault = () =>
    run(async () => {
      setTemplate(await api<TemplateDetails>(`/admin/document-templates/${id}/default`, { method: 'POST' }));
    }, t('prints.version.defaultSet'));

  const remove = (version: DocumentTemplateVersionView) =>
    run(
      async () => {
        await api(`/admin/document-templates/${id}/versions/${version.id}`, { method: 'DELETE' });
        setSelectedId(null);
        await load();
      },
      t('prints.version.deleted', { version: version.versionNo }),
    );

  const downloadVersion = (version: DocumentTemplateVersionView) =>
    void api<DocumentFileLink>(`/admin/document-templates/${id}/versions/${version.id}/file`)
      .then((link) => window.location.assign(fileUrl(link.url)))
      .catch((e: unknown) => setError(errorMessage(e)));

  const upload = async (file: File, note: string) => {
    setPickedFile(null);
    setError(null);
    setNotice(null);
    const form = new FormData();
    form.append('file', file, file.name);
    if (note.trim()) form.append('note', note.trim());
    try {
      const created = await api<DocumentTemplateVersionView>(`/admin/document-templates/${id}/versions`, {
        method: 'POST',
        body: form,
      });
      setFailure(null);
      setTab('preview');
      await load(created.id);
      setNotice(t('prints.version.uploaded', { version: created.versionNo }));
    } catch (e) {
      const details =
        e instanceof ApiRequestError ? (e.details as { issues?: TemplateIssueDetails[] } | undefined) : undefined;
      if (e instanceof ApiRequestError && (e.code === 'TEMPLATE_INVALID' || e.code.startsWith('TEMPLATE_'))) {
        setFailure({
          fileName: file.name,
          sizeBytes: file.size,
          at: new Date().toISOString(),
          issues: e.code === 'TEMPLATE_INVALID' ? (details?.issues ?? []) : [],
          code: e.code === 'TEMPLATE_INVALID' ? null : e.code,
        });
      } else {
        setError(errorMessage(e));
      }
    }
  };

  const activation =
    selected && write && selected.state !== 'ACTIVE' ? (
      <button
        type="button"
        className="btn primary"
        onClick={() =>
          selected.state === 'ARCHIVED' ? setConfirm({ kind: 'restore', version: selected }) : void activate(selected)
        }
      >
        <CheckIcon size={16} />
        {selected.state === 'ARCHIVED'
          ? t('prints.version.restoreN', { version: selected.versionNo })
          : t('prints.version.activateN', { version: selected.versionNo })}
      </button>
    ) : null;

  const nextVersion = (versions[0]?.versionNo ?? 0) + 1;

  return (
    <>
      <nav className="crumbs" aria-label={t('form.backToList')}>
        <Link href={PRINTS_PATHS.templates}>{t('prints.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link href={PRINTS_PATHS.templates}>{t('prints.tabs.templates')}</Link>
        <span aria-hidden="true">/</span>
        <span>{template.name}</span>
      </nav>
      <div className="page-head pr-head">
        <div>
          <h1 className="title-with-pills">
            {template.name}
            {template.isDefault && (
              <span className="pill accent pr-pill-star">
                <StarIcon size={12} />
                {t('prints.templates.default')}
              </span>
            )}
          </h1>
          <div className="sub">
            <span className="code">{template.documentType}</span>
            {' · '}
            {t.dynamic(`prints.types.${template.documentType}.from`)}
            {' · '}
            {active ? t('prints.version.activeSub', { version: active.versionNo }) : t('prints.templates.noActive')}
          </div>
          {template.description && <div className="sub">{template.description}</div>}
        </div>
        <div className="actions">
          <FieldsDocxButton type={template.documentType as TemplateDocumentType} onError={setError} />
          {active && (
            <button type="button" className="btn" onClick={() => downloadVersion(active)}>
              <DownloadIcon size={16} />
              {t('prints.version.downloadActive')}
            </button>
          )}
          {write && !template.isDefault && active && (
            <button type="button" className="btn" onClick={() => void setDefault()}>
              <StarIcon size={16} />
              {t('prints.templates.setDefault')}
            </button>
          )}
          {write && (
            <button type="button" className="btn primary" onClick={pickFile}>
              <UploadIcon size={16} />
              {t('prints.version.upload')}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPickedFile(file);
            }}
          />
        </div>
      </div>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {error && <Banner kind="danger">{error}</Banner>}

      <div className="pr-detail">
        <div className="pr-detail-main">
          <section className="card pr-versions">
            <div className="pr-card-head">
              <h2>{t('prints.version.title')}</h2>
              <span className="small">{t('prints.version.hint')}</span>
            </div>
            {versions.length === 0 && (
              <div className="pr-empty">
                <p>{t('prints.version.empty')}</p>
                {write && (
                  <button type="button" className="btn primary" onClick={pickFile}>
                    <UploadIcon size={16} />
                    {t('prints.version.upload')}
                  </button>
                )}
              </div>
            )}
            {versions.map((version) => (
              <div
                key={version.id}
                className={version.id === selected?.id ? 'pr-vrow selected' : 'pr-vrow'}
                role="button"
                tabIndex={0}
                aria-pressed={version.id === selected?.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button')) setSelectedId(version.id);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                    e.preventDefault();
                    setSelectedId(version.id);
                  }
                }}
              >
                <span className="num pr-vno">{t('prints.version.short', { version: version.versionNo })}</span>
                <span className="stack">
                  <span className="pr-vfile">
                    {t('prints.version.file', {
                      name: version.fileName ?? t('prints.version.noName'),
                      size: formatSize(version.sizeBytes),
                    })}
                  </span>
                  <span className="small">{versionAuthor(version)}</span>
                  {version.note && <span className="small pr-vnote">{version.note}</span>}
                </span>
                <span>
                  <span className={STATE_PILL[version.state]}>
                    {t.dynamic(`prints.version.states.${version.state}`)}
                  </span>
                </span>
                <span className="pr-vact">
                  {version.state === 'PENDING' && (
                    <>
                      <button type="button" className="link pr-link-btn" onClick={() => setSelectedId(version.id)}>
                        {t('prints.version.preview')}
                      </button>
                      {write && (
                        <button
                          type="button"
                          className="link pr-link-btn danger"
                          onClick={() => setConfirm({ kind: 'delete', version })}
                        >
                          {t('prints.version.delete')}
                        </button>
                      )}
                    </>
                  )}
                  {version.state === 'ACTIVE' && (
                    <button type="button" className="link pr-link-btn" onClick={() => downloadVersion(version)}>
                      {t('prints.version.download')}
                    </button>
                  )}
                  {version.state === 'ARCHIVED' &&
                    (write ? (
                      <button
                        type="button"
                        className="link pr-link-btn"
                        onClick={() => setConfirm({ kind: 'restore', version })}
                      >
                        {t('prints.version.restore')}
                      </button>
                    ) : (
                      <button type="button" className="link pr-link-btn" onClick={() => downloadVersion(version)}>
                        {t('prints.version.download')}
                      </button>
                    ))}
                </span>
              </div>
            ))}
          </section>

          {selected && <ValidationCard version={selected} catalog={catalog} type={template.documentType} />}

          <div className="notice info">
            <span className="ic">
              <InfoIcon size={15} />
            </span>
            <span>{t('prints.version.activationNote')}</span>
          </div>
        </div>

        <section className="card pr-preview">
          {selected ? (
            <>
              <div className="pr-preview-bar">
                <div className="pr-seg dark" role="tablist" aria-label={t('prints.version.previewTabs')}>
                  <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
                    {t('prints.version.previewPdf')}
                  </button>
                  <button type="button" role="tab" aria-selected={tab === 'fields'} onClick={() => setTab('fields')}>
                    {t('prints.version.fieldsTab', { count: selected.fields.length })}
                  </button>
                </div>
                <span className="small">{t('prints.version.sample', { version: selected.versionNo })}</span>
              </div>
              {tab === 'preview' ? (
                <PdfPreview
                  templateId={id}
                  version={selected}
                  name={template.name}
                  onError={setError}
                  action={activation}
                />
              ) : (
                <div className="pr-preview-fields">
                  {catalog ? <FieldCatalog catalog={catalog} used={selected.fields} /> : <div aria-busy="true" />}
                </div>
              )}
              {tab === 'fields' && activation && (
                <div className="pr-preview-actions">
                  <span className="grow" />
                  {activation}
                </div>
              )}
            </>
          ) : (
            <p className="muted pr-empty">{t('prints.version.noPreview')}</p>
          )}
        </section>
      </div>

      {pickedFile && (
        <UploadDialog
          file={pickedFile}
          version={nextVersion}
          onClose={() => setPickedFile(null)}
          onUpload={(note) => void upload(pickedFile, note)}
        />
      )}
      {failure && (
        <UploadErrorsDialog
          failure={failure}
          version={nextVersion}
          template={template.name}
          type={template.documentType as TemplateDocumentType}
          catalog={catalog}
          onPick={() => {
            setFailure(null);
            pickFile();
          }}
          onClose={() => setFailure(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        danger={confirm?.kind === 'delete'}
        title={
          confirm
            ? t.dynamic(`prints.version.confirm.${confirm.kind}.title`, { version: confirm.version.versionNo })
            : ''
        }
        body={confirm ? t.dynamic(`prints.version.confirm.${confirm.kind}.body`) : ''}
        action={confirm ? t.dynamic(`prints.version.confirm.${confirm.kind}.action`) : ''}
        onConfirm={() => {
          const current = confirm;
          setConfirm(null);
          if (current?.kind === 'restore') void activate(current.version);
          if (current?.kind === 'delete') void remove(current.version);
        }}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Walidacja
// ---------------------------------------------------------------------------------------------

/** Liczby znaczników wersji według katalogu: pola, pętle i warunki (pola logiczne). */
function tagCounts(fields: readonly string[], catalog: DocumentFieldCatalogView | null) {
  if (!catalog) return null;
  const loops = new Set(catalog.loops.map((l) => l.path));
  const booleans = new Set([
    ...catalog.fields.filter((f) => f.type === 'boolean').map((f) => f.path),
    ...catalog.loops.flatMap((l) => l.fields.filter((f) => f.type === 'boolean').map((f) => `${l.path}[].${f.path}`)),
  ]);
  const usedLoops = fields.filter((f) => loops.has(f));
  const conditions = fields.filter((f) => booleans.has(f)).length;
  return { fields: fields.length - usedLoops.length - conditions, loops: usedLoops, conditions };
}

const warningTag = (w: TemplateWarningDetails, loops: ReadonlySet<string>) =>
  w.loop ? `{${w.loop}[].${w.field}}` : loops.has(w.field) ? `{#${w.field}}` : `{${w.field}}`;

function ValidationCard({
  version,
  catalog,
  type,
}: {
  version: DocumentTemplateVersionView;
  catalog: DocumentFieldCatalogView | null;
  type: string;
}) {
  const counts = tagCounts(version.fields, catalog);
  const loops = new Set(catalog?.loops.map((l) => l.path) ?? []);
  return (
    <section className="card pr-validation">
      <div className="pr-card-head">
        <h2>{t('prints.validation.title', { version: version.versionNo })}</h2>
        <span className="small">{t('prints.validation.when')}</span>
      </div>
      <div className="pr-chk">
        <span className="pr-ok accent" aria-hidden="true">
          <CheckIcon size={13} />
        </span>
        <span>
          {t('prints.validation.file', {
            size: formatSize(version.sizeBytes),
            unpacked: formatSize(version.uncompressedBytes),
          })}
        </span>
      </div>
      <div className="pr-chk">
        <span className="pr-ok accent" aria-hidden="true">
          <CheckIcon size={13} />
        </span>
        <span>
          {counts
            ? t('prints.validation.syntax', {
                fields: counts.fields,
                loops: counts.loops.length,
                conditions: counts.conditions,
              })
            : t('prints.validation.syntaxTotal', { count: version.fields.length })}
          {counts?.loops.map((loop) => (
            <span key={loop} className="pr-tag">{`{#${loop}}`}</span>
          ))}
        </span>
      </div>
      <div className="pr-chk">
        <span className="pr-ok accent" aria-hidden="true">
          <CheckIcon size={13} />
        </span>
        <span>{t('prints.validation.catalog', { type: typeName(type as TemplateDocumentType) })}</span>
      </div>
      {version.warnings.length > 0 ? (
        <div className="pr-chk">
          <span className="pr-ok warn" aria-hidden="true">
            <WarningIcon size={13} />
          </span>
          <span>
            {t('prints.validation.unused', { count: version.warnings.length })}
            {version.warnings.map((w) => (
              <span key={`${w.loop}.${w.field}`} className="pr-tag">
                {warningTag(w, loops)}
              </span>
            ))}
          </span>
        </div>
      ) : (
        <div className="pr-chk">
          <span className="pr-ok accent" aria-hidden="true">
            <CheckIcon size={13} />
          </span>
          <span>{t('prints.validation.allUsed')}</span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Podgląd PDF
// ---------------------------------------------------------------------------------------------

/** Podgląd zapamiętany w pamięci karty: kolejne otwarcia wersji nie wołają API. */
const previews = new Map<string, Blob>();

function PdfPreview({
  templateId,
  version,
  name,
  onError,
  action,
}: {
  templateId: string;
  version: DocumentTemplateVersionView;
  name: string;
  onError: (message: string) => void;
  /** „Aktywuj wersję” albo „Przywróć wersję” w tym samym wierszu co „Pobierz PDF” (makieta). */
  action: ReactNode;
}) {
  const [state, setState] = useState<{ id: string; url: string; blob: Blob } | { id: string; error: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    const cached = previews.get(version.id);
    const request = cached
      ? Promise.resolve(cached)
      : apiBlob(`/admin/document-templates/${templateId}/versions/${version.id}/preview.pdf`);
    request
      .then((blob) => {
        previews.set(version.id, blob);
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ id: version.id, url: objectUrl, blob });
      })
      .catch((e: unknown) => current && setState({ id: version.id, error: errorMessage(e) }));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [templateId, version.id, attempt]);

  const shown = state && state.id === version.id ? state : null;
  const fileName = t('prints.version.previewFile', {
    name: name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .toLowerCase(),
    version: version.versionNo,
  });

  return (
    <>
      <div className="pr-paper">
        {!shown && (
          <div className="pr-paper-state" role="status">
            <span className="pr-spin" aria-hidden="true" />
            <span className="small">{t('prints.version.previewLoading')}</span>
          </div>
        )}
        {shown && 'error' in shown && (
          <div className="pr-paper-state" role="alert">
            <AlertIcon size={20} />
            <span className="small">{shown.error}</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                previews.delete(version.id);
                setState(null);
                setAttempt((n) => n + 1);
              }}
            >
              {t('prints.print.retry')}
            </button>
          </div>
        )}
        {shown && 'url' in shown && (
          // `<object>` z treścią zastępczą: przeglądarka bez wbudowanej przeglądarki PDF pokazuje „Pobierz PDF”.
          <object
            data={`${shown.url}#view=FitH&toolbar=0`}
            type="application/pdf"
            aria-label={t('prints.version.previewTitle', { version: version.versionNo })}
          >
            <div className="pr-paper-state">
              <DocumentIcon size={20} />
              <span className="small">{t('prints.version.previewUnsupported')}</span>
              <button type="button" className="btn" onClick={() => saveBlob(shown.blob, fileName)}>
                <DownloadIcon size={16} />
                {t('prints.print.downloadPdf')}
              </button>
            </div>
          </object>
        )}
      </div>
      <div className="pr-preview-actions">
        <button
          type="button"
          className="btn"
          disabled={!shown || !('blob' in shown)}
          onClick={() => {
            if (shown && 'blob' in shown) saveBlob(shown.blob, fileName);
            else onError(t('prints.version.previewLoading'));
          }}
        >
          <DownloadIcon size={16} />
          {t('prints.print.downloadPdf')}
        </button>
        <span className="grow" />
        {action}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Wgranie wersji
// ---------------------------------------------------------------------------------------------

function UploadDialog({
  file,
  version,
  onClose,
  onUpload,
}: {
  file: File;
  version: number;
  onClose: () => void;
  onUpload: (note: string) => void;
}) {
  const ref = useModal();
  const [note, setNote] = useState('');
  return (
    <dialog ref={ref} className="pr-dialog" onClose={onClose} aria-labelledby="upload-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <UploadIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="upload-title">{t('prints.upload.title', { version })}</h2>
          <p>{t('prints.upload.sub')}</p>
        </div>
      </div>
      <div className="pr-filebox">
        <DocumentIcon size={18} />
        <span className="stack grow">
          <span className="strong">{file.name}</span>
          <span className="small">{formatSize(file.size)}</span>
        </span>
      </div>
      <label className="field">
        <span className="label">
          {t('prints.upload.note')} <span className="opt">{t('common.optional')}</span>
        </span>
        <input
          className="input"
          value={note}
          maxLength={300}
          placeholder={t('prints.upload.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="actions pr-dlg-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" onClick={() => onUpload(note)}>
          <UploadIcon size={16} />
          {t('prints.upload.submit')}
        </button>
      </div>
    </dialog>
  );
}

/** Miejsce w dokumencie w języku autora: część, tabela z podpisem, wiersz, kolumna albo akapit z fragmentem. */
function placeText(place: TemplatePlace): string {
  const parts: string[] = [];
  if (place.part !== 'document') {
    parts.push(
      place.partNumber !== null
        ? t.dynamic(`prints.place.parts.${place.part}N`, { n: place.partNumber })
        : t.dynamic(`prints.place.parts.${place.part}`),
    );
  }
  if (place.table !== null) {
    parts.push(
      place.tableCaption
        ? t('prints.place.tableCaption', { n: place.table, caption: place.tableCaption })
        : t('prints.place.table', { n: place.table }),
    );
    if (place.row !== null) parts.push(t('prints.place.row', { n: place.row }));
    if (place.column !== null) parts.push(t('prints.place.column', { n: place.column }));
  }
  if (place.paragraph !== null) {
    parts.push(
      place.excerpt
        ? t('prints.place.paragraphExcerpt', { n: place.paragraph, excerpt: place.excerpt })
        : t('prints.place.paragraph', { n: place.paragraph }),
    );
  }
  const text = parts.join(', ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : t('prints.place.document');
}

/** Pola wspólne wszystkich rodzajów; w podpowiedzi tylko, gdy znacznik ma ten sam przedrostek. */
const COMMON_PREFIXES = ['company.', 'document.', 'template.', 'staff.'];

function IssueHelp({ issue }: { issue: UploadFailure['issues'][number] }) {
  const hint = t.has(`prints.issues.${issue.code}.hint`) ? t.dynamic(`prints.issues.${issue.code}.hint`) : null;
  // Najpierw pola z tym samym przedrostkiem co znacznik (`task.*` przy `{task.partCost}`), bez pól wspólnych.
  const prefix = (issue.tag ?? '').replace(/^\{[#/^]?/, '').split('.')[0] ?? '';
  const same = issue.available.filter((f) => f.split('.')[0] === prefix);
  const own = issue.available.filter((f) => !COMMON_PREFIXES.some((p) => f.startsWith(p)));
  const available = (same.length ? same : own.length ? own : issue.available).slice(0, 12).join(', ');
  return (
    <span className="pr-issue-help">
      {issue.suggestion && (
        <>
          {t('prints.issues.suggestion')} <span className="pr-tag">{`{${issue.suggestion}}`}</span>?{' '}
        </>
      )}
      {issue.loop && available ? (
        <>
          {t('prints.issues.inLoop')} <span className="pr-tag">{`{#${issue.loop}}`}</span>{' '}
          {t('prints.issues.available', { fields: available })}
        </>
      ) : (
        available && t('prints.issues.availableFields', { fields: available })
      )}
      {hint && <> {hint}</>}
      {issue.reason && <> {t('prints.issues.reason', { reason: issue.reason })}</>}
    </span>
  );
}

function UploadErrorsDialog({
  failure,
  version,
  template,
  type,
  onPick,
  onClose,
}: {
  failure: UploadFailure;
  version: number;
  template: string;
  type: TemplateDocumentType;
  catalog: DocumentFieldCatalogView | null;
  onPick: () => void;
  onClose: () => void;
}) {
  const ref = useModal();
  const [error, setError] = useState<string | null>(null);
  const count = failure.code ? 1 : failure.issues.length;
  return (
    <dialog ref={ref} className="pr-dialog wide" onClose={onClose} aria-labelledby="errors-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic danger" aria-hidden="true">
          <AlertIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="errors-title">{t('prints.upload.errorsTitle', { count })}</h2>
          <p>{t('prints.upload.errorsSub', { version, template })}</p>
        </div>
      </div>
      <div className="pr-filebox">
        <DocumentIcon size={18} />
        <span className="stack grow">
          <span className="strong">{failure.fileName}</span>
          <span className="small">
            {failure.code
              ? formatSize(failure.sizeBytes)
              : t('prints.upload.recognized', { size: formatSize(failure.sizeBytes) })}
          </span>
        </span>
        <span className="small">{t('prints.upload.at', { time: formatClock(failure.at) })}</span>
      </div>
      <ol className="pr-issues">
        {failure.code && (
          <li className="pr-issue">
            <span className="pr-issue-no num">1</span>
            <span className="stack">
              <span className="strong">{errorMessage(new ApiRequestError(422, failure.code))}</span>
              <span className="pr-issue-help">{t.dynamic(`prints.issues.${failure.code}.hint`)}</span>
            </span>
          </li>
        )}
        {failure.issues.map((issue, i) => (
          <li key={i} className="pr-issue">
            <span className="pr-issue-no num">{i + 1}</span>
            <span className="stack">
              <span className="strong">
                {t.has(`prints.issues.${issue.code}.title`)
                  ? t.dynamic(`prints.issues.${issue.code}.title`)
                  : t('prints.issues.other', { code: issue.code })}
                {issue.tag && <span className="pr-tag bad">{issue.tag}</span>}
              </span>
              {issue.place && (
                <span className="small pr-issue-place">
                  <DocumentIcon size={13} />
                  {placeText(issue.place)}
                </span>
              )}
              <IssueHelp issue={issue} />
            </span>
          </li>
        ))}
      </ol>
      <p className="small pr-issues-note">{t('prints.upload.errorsNote')}</p>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="actions pr-dlg-actions">
        <FieldsDocxButton type={type} onError={setError} />
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="button" className="btn primary" onClick={onPick}>
          <UploadIcon size={16} />
          {t('prints.upload.pickAnother')}
        </button>
      </div>
    </dialog>
  );
}
