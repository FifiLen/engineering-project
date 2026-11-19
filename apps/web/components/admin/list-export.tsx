'use client';

/**
 * Eksport listy do XLSX i CSV (ADR 0073, makieta 34-panel-domkniecie/lista-eksport): okno z formatem, zakresem
 * (liczba wierszy z `total` listy, filtry, wyszukiwanie, sortowanie, kolumny), ostrzeżeniem o danych osobowych tylko
 * przy kolumnach `personal` i limitem `LIST_EXPORT_LIMIT` sprawdzanym przed wysłaniem (API sprawdza ponownie:
 * `422 LIST_EXPORT_LIMIT`). Plik powstaje w API strumieniem z tym samym zapytaniem co lista (`POST /admin/{zasób}/export`
 * z etykietami kolumn z `pl.json`), a panel zapisuje go przez `saveBlob` pod nazwą z `content-disposition`.
 */
import {
  LIST_EXPORT_LIMIT,
  personalFields,
  toSearchParams,
  type FieldDefinition,
  type ListExportColumn,
  type ListExportFormat,
  type ListQuery,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { apiDownload, ApiRequestError, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { AlertIcon, DownloadIcon, FilterIcon, InfoIcon, ShieldIcon } from './icons';
import { fieldLabel, filterLabel, valueLabel } from './labels';
import { saveBlob } from './prints/prints-common';

export type ExportParams = Record<string, string | string[]>;

/** Parametry listy dla treści eksportu: te same co w adresie listy, bez strony, rozmiaru strony i liczników. */
export function exportParams(resource: ResourceDefinition, query: ListQuery, extra: ExportParams = {}): ExportParams {
  const params: ExportParams = {};
  const search = toSearchParams(resource, { ...query, page: 1, facets: [] });
  for (const [key, value] of search.entries()) {
    if (key === 'page' || key === 'pageSize' || key === 'facets') continue;
    const current = params[key];
    params[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  }
  return { ...params, ...extra };
}

/** Opis zakresu z zapytania listy: filtry, wyszukiwanie i sortowanie (domyślne z definicji, gdy brak). */
export function exportScope(resource: ResourceDefinition, query: ListQuery) {
  const sort = query.sort.length
    ? query.sort
    : resource.defaultSort.map((key) => ({ field: key.replace(/^-/, ''), desc: key.startsWith('-') }));
  return {
    filters: query.filters.map((f) => `${fieldLabel(resource, f.field)}: ${filterLabel(resource, f)}`),
    search: query.q,
    sort: sort
      .map((s) => `${fieldLabel(resource, s.field)} ${t(s.desc ? 'list.descending' : 'list.ascending')}`)
      .join(', '),
  };
}

/** Kolumny eksportu z etykietami panelu; pola `enum` niosą teksty wartości (API nie trzyma kopii `pl.json`). */
export function exportColumns(resource: ResourceDefinition, fields: readonly string[]): ListExportColumn[] {
  const defs = resource.fields as Record<string, FieldDefinition>;
  return fields
    .filter((field, i) => defs[field] && fields.indexOf(field) === i)
    .map((field) => {
      const def = defs[field]!;
      const label = fieldLabel(resource, field).slice(0, 80);
      if (def.type !== 'enum' || !def.values) return { field, label };
      return {
        field,
        label,
        values: Object.fromEntries(def.values.map((v) => [v, valueLabel(resource, field, v).slice(0, 80)])),
      };
    });
}

/** Pole klienta maskowane bez `users.read` (API wstawia „Klient” tak jak w liście). */
const customerField = (resource: ResourceDefinition, field: string) =>
  field.startsWith('user') || resource.permissions.read === 'users.read';

/** „przejazdy-2026-11-19-1435.xlsx”: nazwa jak w API (czas polski), do podpowiedzi przed pobraniem. */
function expectedFileName(name: string, format: ListExportFormat): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${name}-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.${format}`;
}

export interface ListExportProps {
  /** Definicja pól (typy i etykiety); `resource.name` to też nazwa pliku i rzeczownik tytułu. */
  resource: ResourceDefinition;
  /** Punkt eksportu, domyślnie `/admin/{zasób}/export`. */
  endpoint?: string;
  params: ExportParams;
  /** Liczba wierszy z `total` listy; `null`: nieznana (telemetria liczy tylko w API). */
  rows: number | null;
  /** Tekst wiersza „Wiersze”, gdy liczba jest nieznana. */
  rowsText?: string;
  filters: string[];
  search?: string;
  sort?: string;
  columns: readonly string[];
  /** „Zmień filtry” przy przekroczonym limicie (np. otwiera panel filtrów listy). */
  onChangeFilters?: () => void;
  /** Wynik pobrania dla komunikatu listy (nazwa zapisanego pliku). */
  onDone?: (fileName: string) => void;
}

/** Przycisk „Eksportuj” w pasku listy z oknem eksportu. */
export function ExportButton(props: ListExportProps & { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" disabled={props.disabled} onClick={() => setOpen(true)}>
        <DownloadIcon size={16} />
        {t('listExport.open')}
      </button>
      {open && (
        <ListExportDialog
          {...props}
          onChangeFilters={
            props.onChangeFilters
              ? () => {
                  setOpen(false);
                  props.onChangeFilters?.();
                }
              : undefined
          }
          onDone={(fileName) => {
            setOpen(false);
            props.onDone?.(fileName);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string; limit?: number; count?: number };

export function ListExportDialog(props: ListExportProps & { onClose: () => void }) {
  const { resource, params, rows, columns, onClose } = props;
  const { can } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [format, setFormat] = useState<ListExportFormat>('xlsx');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    return () => abort.current?.abort();
  }, []);

  const cols = exportColumns(resource, columns);
  const personal = new Set(personalFields(resource));
  const masked = !can('users.read');
  const personalCols = cols.filter((c) => personal.has(c.field));
  const visiblePersonal = personalCols.filter((c) => !(masked && customerField(resource, c.field)));
  const maskedPersonal = masked && personalCols.some((c) => customerField(resource, c.field));
  const limitCount = phase.kind === 'error' && phase.limit !== undefined ? (phase.count ?? rows) : null;
  const overLimit = (rows !== null && rows > LIST_EXPORT_LIMIT) || limitCount !== null;
  const empty = rows === 0;
  const formatName = t.dynamic(`listExport.formats.${format}.short`);
  const noun = t.has(`listExport.nouns.${resource.name}`)
    ? t.dynamic(`listExport.nouns.${resource.name}`)
    : t.dynamic(`resource.${resource.name}.title`).toLowerCase();

  const download = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'loading' });
    try {
      const { blob, fileName } = await apiDownload(props.endpoint ?? `/admin/${resource.name}/export`, {
        json: { query: params, format, columns: cols },
        signal: controller.signal,
      });
      const name = fileName ?? expectedFileName(resource.name, format);
      saveBlob(blob, name);
      setPhase({ kind: 'idle' });
      props.onDone?.(name);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      const details =
        error instanceof ApiRequestError && typeof error.details === 'object' && error.details
          ? (error.details as { count?: number; limit?: number })
          : {};
      setPhase({
        kind: 'error',
        message: errorMessage(error),
        ...(error instanceof ApiRequestError && error.code === 'LIST_EXPORT_LIMIT'
          ? { limit: details.limit ?? LIST_EXPORT_LIMIT, count: details.count }
          : {}),
      });
    }
  };

  const columnList = cols.map((c) => c.label).join(', ');
  return (
    <dialog ref={ref} className="end-dialog lx-dialog" onClose={onClose} aria-labelledby="lx-title">
      <div className="end-head">
        <span className="end-icon lx-icon" aria-hidden="true">
          <DownloadIcon size={20} />
        </span>
        <div>
          <h2 id="lx-title">{t('listExport.title', { noun })}</h2>
          <p>{t('listExport.lead')}</p>
        </div>
      </div>

      {phase.kind === 'loading' ? (
        <div className="lx-progress" role="status">
          <span className="pr-spin" aria-hidden="true" />
          <span className="stack">
            <b>{t('listExport.loading', { format: formatName })}</b>
            <span className="small">
              {rows !== null ? t('listExport.loadingRows', { count: rows }) : t('listExport.loadingUnknown')}
            </span>
            <span className="small">{t('listExport.loadingHint')}</span>
          </span>
        </div>
      ) : (
        <>
          <div className="lx-section">
            <span className="label" id="lx-format">
              {t('listExport.format')}
            </span>
            <div className="zc-seg lx-seg" role="radiogroup" aria-labelledby="lx-format">
              {(['xlsx', 'csv'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={format === value}
                  onClick={() => setFormat(value)}
                >
                  {t.dynamic(`listExport.formats.${value}.label`)}
                </button>
              ))}
            </div>
          </div>

          <div className="lx-section">
            <span className="label">{t('listExport.scope')}</span>
            <dl className="lx-box">
              <div>
                <dt>{t('listExport.rows')}</dt>
                <dd className="num">
                  {rows !== null ? t('listExport.rowsValue', { count: rows }) : (props.rowsText ?? t('common.none'))}
                </dd>
              </div>
              <div>
                <dt>{t('listExport.filters')}</dt>
                <dd>{props.filters.length ? props.filters.join(' · ') : t('listExport.none')}</dd>
              </div>
              <div>
                <dt>{t('listExport.search')}</dt>
                <dd className={props.search ? undefined : 'muted'}>{props.search || t('listExport.none')}</dd>
              </div>
              {props.sort && (
                <div>
                  <dt>{t('listExport.sort')}</dt>
                  <dd>{props.sort}</dd>
                </div>
              )}
              <div>
                <dt>{t('listExport.columns')}</dt>
                <dd>{t('listExport.columnsValue', { count: cols.length, list: columnList })}</dd>
              </div>
            </dl>
          </div>

          {overLimit && (
            <div className="notice danger lx-notice" role="alert">
              <span className="ic" aria-hidden="true">
                <AlertIcon size={16} />
              </span>
              <span className="stack">
                <b>{t('listExport.limitTitle')}</b>
                <span>
                  {t('listExport.limitBody', { count: limitCount ?? rows ?? 0, limit: LIST_EXPORT_LIMIT })}
                </span>
              </span>
            </div>
          )}
          {!overLimit && empty && (
            <div className="notice info lx-notice">
              <span className="ic" aria-hidden="true">
                <InfoIcon size={16} />
              </span>
              <span>{t('listExport.empty')}</span>
            </div>
          )}
          {visiblePersonal.length > 0 && !overLimit && (
            <div className="notice warn lx-notice">
              <span className="ic" aria-hidden="true">
                <ShieldIcon size={16} />
              </span>
              <span>
                {t('listExport.personal', {
                  fields: visiblePersonal.map((c) => c.label.toLowerCase()).join(', '),
                })}
              </span>
            </div>
          )}
          {maskedPersonal && !overLimit && (
            <div className="notice info lx-notice">
              <span className="ic" aria-hidden="true">
                <ShieldIcon size={16} />
              </span>
              <span>{t('listExport.masked')}</span>
            </div>
          )}
          {phase.kind === 'error' && phase.limit === undefined && (
            <div className="notice danger lx-notice" role="alert">
              <span className="ic" aria-hidden="true">
                <AlertIcon size={16} />
              </span>
              <span>{t('listExport.failed', { message: phase.message })}</span>
            </div>
          )}

          <span className="hint lx-file">
            {t('listExport.fileHint', {
              file: expectedFileName(resource.name, format),
              hint: t.dynamic(`listExport.formats.${format}.hint`),
            })}
          </span>
        </>
      )}

      <div className="actions">
        {overLimit && props.onChangeFilters && (
          <button type="button" className="btn lx-left" onClick={props.onChangeFilters}>
            <FilterIcon />
            {t('listExport.changeFilters')}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={overLimit || empty || phase.kind === 'loading' || cols.length === 0}
          onClick={() => void download()}
        >
          <DownloadIcon size={16} />
          {phase.kind === 'error' && phase.limit === undefined
            ? t('listExport.retry')
            : t('listExport.submit', { format: formatName })}
        </button>
      </div>
    </dialog>
  );
}
