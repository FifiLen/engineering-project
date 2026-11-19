'use client';

/**
 * „Drukuj” na kartach obiektów (ADR 0068, makieta wydruki-drukuj): okno z wyborem szablonu (domyślny zaznaczony),
 * formatem i parametrami z katalogu, zlecenie `POST /admin/documents` (202) i stany Generowanie, Gotowe i Błąd.
 * Okno czeka na `document.ready` w pokoju `staff:{id}`, a w zapasie pyta `GET /admin/documents/{id}` co 2 s; po 30 s
 * pokazuje, że wydruk trwa dłużej, ale zadanie działa dalej i dokument trafi do Wygenerowanych.
 */
import {
  DOCUMENT_POLL_INTERVAL_MS,
  DOCUMENT_WAIT_TIMEOUT_MS,
  type DocumentFormat,
  type DocumentParamView,
  type DocumentType,
  type DocumentTypeView,
  type GeneratedDocumentView,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { AlertIcon, CheckIcon, CloseIcon, DownloadIcon, PrinterIcon, RetryIcon } from '../icons';
import {
  CUSTOMER_DOCUMENT_TYPES,
  formatSize,
  openDocumentFile,
  PRINTS_PATHS,
  shortId,
  useModal,
  usePrintableType,
} from './prints-common';

type ParamValue = string | number | boolean;

const footerDate = new Intl.DateTimeFormat('pl', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});

/** Stopka jak w dokumencie: „Wydruk {id} · {szablon} v{n} · data · operator” (ADR 0068). */
export function documentFooter(doc: GeneratedDocumentView): string {
  return t('prints.print.footer', {
    id: shortId(doc.id),
    template: doc.template
      ? t('prints.templateVersion', { name: doc.template.name, version: doc.template.versionNo })
      : t('prints.builtIn'),
    date: footerDate.format(new Date(doc.startedAt ?? doc.createdAt)),
    requester: doc.requestedBy.kind === 'staff' ? doc.requestedBy.name : t('prints.app'),
  });
}

/**
 * Stan wydruku do chwili stanu końcowego: zdarzenie `document.ready` przyspiesza odczyt, a odpytywanie co 2 s
 * jest zapasem (Socket.IO rozłączone, zdarzenie z przerwy). `slow` po 30 s bez wyniku.
 */
export function useGeneratedDocument(initial: GeneratedDocumentView) {
  const [doc, setDoc] = useState(initial);
  const [slow, setSlow] = useState(false);
  const id = initial.id;
  const finished = doc.status === 'SUCCEEDED' || doc.status === 'FAILED';
  const refresh = useCallback(() => {
    void api<GeneratedDocumentView>(`/admin/documents/${id}`)
      .then(setDoc)
      .catch(() => undefined);
  }, [id]);
  useStaffFeed(
    finished
      ? {}
      : {
          documentReady: (ready) => {
            if (ready.id === id) refresh();
          },
          reconnected: refresh,
        },
  );
  useEffect(() => {
    if (finished) return;
    const poll = setInterval(refresh, DOCUMENT_POLL_INTERVAL_MS);
    const timeout = setTimeout(() => setSlow(true), DOCUMENT_WAIT_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [finished, refresh]);
  return { doc, slow, finished };
}

interface PrintButtonProps {
  documentType: DocumentType;
  entityId: string;
  /** Numer obiektu w tytule okna: `S-1037`, `R-51858`, `#0007`, `PAR/2026/000126`. */
  entityLabel: string;
  /** Opis zawartości z karty obiektu („Części: 2 pozycje, 36,50 zł · notatka”); domyślnie opis rodzaju. */
  summary?: string;
  /** Sama ikona (wiersz księgi portfela) zamiast przycisku z podpisem. */
  compact?: boolean;
}

/** Przycisk „Drukuj”: widoczny tylko dla rodzaju, który operator może wydrukować (`printable` z API). */
export function PrintButton({ documentType, entityId, entityLabel, summary, compact }: PrintButtonProps) {
  const type = usePrintableType(documentType);
  const [open, setOpen] = useState(false);
  if (!type) return null;
  return (
    <>
      {compact ? (
        <button
          type="button"
          className="icon-btn plain"
          aria-label={t.dynamic(`prints.types.${documentType}.printTitle`, { number: entityLabel })}
          title={t('prints.print.open')}
          onClick={() => setOpen(true)}
        >
          <PrinterIcon size={16} />
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          <PrinterIcon size={16} />
          {t('prints.print.open')}
        </button>
      )}
      {open && (
        <PrintDialog
          type={type}
          entityId={entityId}
          entityLabel={entityLabel}
          summary={summary}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface PrintDialogProps {
  type: DocumentTypeView;
  entityId: string;
  entityLabel: string;
  summary?: string;
  onClose: () => void;
}

const defaults = (params: DocumentParamView[]) =>
  Object.fromEntries(params.map((p) => [p.name, p.default])) as Record<string, ParamValue>;

export function PrintDialog({ type, entityId, entityLabel, summary, onClose }: PrintDialogProps) {
  const ref = useModal();
  const { can } = useSession();
  const templates = type.templates
    .filter((tpl) => tpl.activeVersionNo !== null)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'pl'));
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [format, setFormat] = useState<DocumentFormat>('PDF');
  const [params, setParams] = useState(() => defaults(type.params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<GeneratedDocumentView | null>(null);
  const customerHidden = CUSTOMER_DOCUMENT_TYPES.has(type.documentType) && !can('users.read');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setDoc(
        await api<GeneratedDocumentView>('/admin/documents', {
          method: 'POST',
          json: { documentType: type.documentType, entityId, templateId, format, params },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    setError(null);
    try {
      setDoc(await api<GeneratedDocumentView>(`/admin/documents/${id}/retry`, { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <dialog ref={ref} className="pr-dialog" onClose={onClose} aria-labelledby="print-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <PrinterIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="print-title">{t.dynamic(`prints.types.${type.documentType}.printTitle`, { number: entityLabel })}</h2>
          <p>{t.dynamic(`prints.types.${type.documentType}.printSub`)}</p>
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {doc ? (
        <DocumentProgress key={doc.id} initial={doc} onRetry={(id) => void retry(id)} />
      ) : (
        <>
          <div className="pr-field" role="radiogroup" aria-label={t('prints.print.template')}>
            <span className="label">{t('prints.print.template')}</span>
            {templates.map((tpl) => (
              <label key={tpl.id} className={templateId === tpl.id ? 'pr-choice on' : 'pr-choice'}>
                <input
                  type="radio"
                  name="print-template"
                  checked={templateId === tpl.id}
                  onChange={() => setTemplateId(tpl.id)}
                />
                <span className="stack">
                  <span className="pr-choice-name">{tpl.name}</span>
                  <span className="small">
                    {[
                      tpl.isDefault && t('prints.print.default'),
                      t('prints.print.version', { version: tpl.activeVersionNo ?? 0 }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="pr-field">
            <span className="label" id="print-format">
              {t('prints.print.format')}
            </span>
            <div className="pr-seg" role="radiogroup" aria-labelledby="print-format">
              {(['PDF', 'DOCX'] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)}>
                  {t.dynamic(`prints.print.formats.${f}`)}
                </button>
              ))}
            </div>
          </div>

          {type.params.length > 0 && (
            <div className="pr-field">
              <span className="label">{t('prints.print.params')}</span>
              {type.params.map((param) => (
                <ParamInput
                  key={param.name}
                  param={param}
                  value={params[param.name] ?? param.default}
                  onChange={(value) => setParams((p) => ({ ...p, [param.name]: value }))}
                />
              ))}
            </div>
          )}

          <div className="pr-box">
            <span className="label">{t('prints.print.contents')}</span>
            <span>{summary ?? t.dynamic(`prints.types.${type.documentType}.contents`)}</span>
            {customerHidden && <span className="muted">{t('prints.print.customerHidden')}</span>}
          </div>

          {error && (
            <div className="err" role="alert">
              {error}
            </div>
          )}

          <div className="actions pr-dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn primary" disabled={busy || !templateId} onClick={() => void submit()}>
              <PrinterIcon size={16} />
              {t.dynamic(`prints.print.generate.${format}`)}
            </button>
          </div>
        </>
      )}
      {doc && error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
    </dialog>
  );
}

/** Parametr z katalogu: pole wyboru (`boolean`) albo przełącznik wartości (`select`). */
function ParamInput({
  param,
  value,
  onChange,
}: {
  param: DocumentParamView;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}) {
  const label = t.dynamic(`prints.params.${param.name}.label`);
  if (param.type === 'boolean') {
    return (
      <label className="pr-check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  return (
    <div className="pr-param">
      <span className="small">{label}</span>
      <div className="pr-seg" role="radiogroup" aria-label={label}>
        {(param.options ?? []).map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
          >
            {t.has(`prints.params.${param.name}.options.${option}`)
              ? t.dynamic(`prints.params.${param.name}.options.${option}`)
              : String(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Stany okna po zleceniu (makieta: Generowanie, Gotowe, Błąd). */
function DocumentProgress({ initial, onRetry }: { initial: GeneratedDocumentView; onRetry: (id: string) => void }) {
  const { doc, slow } = useGeneratedDocument(initial);
  const [error, setError] = useState<string | null>(null);
  const download = (kind: 'pdf' | 'docx') =>
    void openDocumentFile(doc.id, kind, doc.files[kind]).catch((e: unknown) => setError(errorMessage(e)));

  if (doc.status === 'SUCCEEDED') {
    const main = doc.format === 'PDF' ? doc.files.pdf : doc.files.docx;
    return (
      <div className="pr-state" role="status">
        <div className="pr-state-head">
          <span className="pr-state-ic accent" aria-hidden="true">
            <CheckIcon size={15} />
          </span>
          <span className="stack">
            <span className="pr-state-title">{t('prints.print.ready')}</span>
            {main && (
              <span className="small">
                {t('prints.print.file', { name: main.fileName, size: formatSize(main.sizeBytes) })}
              </span>
            )}
          </span>
        </div>
        <div className="actions">
          {doc.files.pdf && (
            <button type="button" className="btn primary" onClick={() => download('pdf')}>
              <DownloadIcon size={16} />
              {t('prints.print.downloadPdf')}
            </button>
          )}
          {doc.files.docx && (
            <button type="button" className={doc.files.pdf ? 'btn' : 'btn primary'} onClick={() => download('docx')}>
              <DownloadIcon size={16} />
              {t('prints.print.downloadDocx')}
            </button>
          )}
        </div>
        <div className="pr-foot">
          {t('prints.print.footerLabel')}
          <br />
          <span>{documentFooter(doc)}</span>
        </div>
        {error && <span className="err">{error}</span>}
      </div>
    );
  }

  if (doc.status === 'FAILED') {
    const code = doc.errorCode ?? 'RENDER_FAILED';
    return (
      <div className="pr-state" role="alert">
        <div className="pr-state-head">
          <span className="pr-state-ic danger" aria-hidden="true">
            <AlertIcon size={15} />
          </span>
          <span className="stack">
            <span className="pr-state-title">
              {doc.format === 'PDF' ? t('prints.print.failedPdf') : t('prints.print.failed')}
            </span>
            <span className="small">{doc.files.docx ? t('prints.print.failedWithDocx', { code }) : code}</span>
          </span>
        </div>
        <span className="pr-state-body">
          {t.has(`prints.errorCodes.${code}`) ? t.dynamic(`prints.errorCodes.${code}`) : t('prints.errorCodes.other')}
        </span>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onRetry(doc.id)}>
            <RetryIcon size={16} />
            {t('prints.print.retry')}
          </button>
          {doc.files.docx && (
            <button type="button" className="btn" onClick={() => download('docx')}>
              <DownloadIcon size={16} />
              {t('prints.print.downloadDocx')}
            </button>
          )}
        </div>
        {error && <span className="err">{error}</span>}
      </div>
    );
  }

  return (
    <div className="pr-state" role="status" aria-live="polite">
      <div className="pr-state-head">
        <span className="pr-spin" aria-hidden="true" />
        <span className="stack">
          <span className="pr-state-title">{t.dynamic(`prints.print.generating.${doc.format}`)}</span>
          <span className="small">
            {doc.status === 'QUEUED' ? t('prints.print.queued') : t('prints.print.running')}
          </span>
        </span>
      </div>
      <div className="pr-bar" aria-hidden="true">
        <span />
      </div>
      <span className="small">
        {slow ? t('prints.print.slow') : t('prints.print.canClose')}{' '}
        <Link className="link" href={PRINTS_PATHS.generated}>
          {t('prints.tabs.generated')}
        </Link>
      </span>
    </div>
  );
}
