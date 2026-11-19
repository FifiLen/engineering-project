'use client';

/**
 * Katalog pól rodzaju dla autora szablonu (ADR 0067): pola i pętle z `GET /admin/document-types/{type}/fields`
 * (jedyne źródło to core), z zaznaczeniem pól użytych w wersji i pól klienta, oraz „Lista pól (DOCX)”
 * z szablonu systemowego w API.
 */
import type { DocumentFieldCatalogView, DocumentFieldView, TemplateDocumentType } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api, apiBlob, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { DocumentIcon } from '../icons';
import { saveBlob } from './prints-common';

/** Katalog pól rodzaju (wspólny dla zakładki „Pola”, okna błędów i instrukcji). */
export function useFieldCatalog(type: TemplateDocumentType | null): DocumentFieldCatalogView | null {
  const [catalog, setCatalog] = useState<DocumentFieldCatalogView | null>(null);
  useEffect(() => {
    if (!type) return;
    let current = true;
    api<DocumentFieldCatalogView>(`/admin/document-types/${type}/fields`)
      .then((c) => current && setCatalog(c))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [type]);
  return catalog && catalog.documentType === type ? catalog : null;
}

/** „Lista pól (DOCX)”: plik z API pobrany z tokenem i zapisany pod nazwą rodzaju. */
export function FieldsDocxButton({ type, onError }: { type: TemplateDocumentType; onError?: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await apiBlob(`/admin/document-types/${type}/fields.docx`);
      saveBlob(blob, t('prints.fields.fileName', { type: type.toLowerCase().replace(/_/g, '-') }));
    } catch (e) {
      onError?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
      <DocumentIcon size={16} />
      {t('prints.fields.docx')}
    </button>
  );
}

/** Ścieżka użycia pola w wersji: pole pętli jako `parts[].cost` (jak `fields` wersji z core). */
const usedPaths = (field: DocumentFieldView, loop?: string) =>
  loop ? [`${loop}[].${field.path}`, `${loop}.${field.path}`] : [field.path];

function FieldRow({ field, used, loop }: { field: DocumentFieldView; used?: ReadonlySet<string>; loop?: string }) {
  // Wersje startowe sprzed poprawki zapisują pola pętli jako `parts.cost`, nowe jako `parts[].cost`.
  const unused = used && !usedPaths(field, loop).some((path) => used.has(path));
  return (
    <div className="pr-frow" role="row">
      <span role="cell">
        <span className={unused ? 'pr-tag muted' : 'pr-tag'}>{`{${field.path}}`}</span>
      </span>
      <span role="cell" className="stack">
        <span>{field.label}</span>
        <span className="small">
          {[
            t.dynamic(`prints.fields.types.${field.type}`),
            field.example && t('prints.fields.example', { example: field.example }),
            field.customer && t('prints.fields.customer'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {used && (
        <span role="cell" className="small">
          {unused ? t('prints.fields.unused') : t('prints.fields.used')}
        </span>
      )}
    </div>
  );
}

/**
 * Pola i pętle rodzaju; z `used` (pola wersji) pola nieużyte są wyszarzone, jak ostrzeżenie walidacji.
 * Pola wspólne (`company.*`, `document.*`) są na końcu, żeby pola rodzaju były od razu widoczne.
 */
export function FieldCatalog({ catalog, used }: { catalog: DocumentFieldCatalogView; used?: readonly string[] }) {
  const usedSet = used ? new Set(used) : undefined;
  const own = catalog.fields.filter((f) => !f.common);
  const common = catalog.fields.filter((f) => f.common);
  return (
    <div className="pr-catalog" role="table" aria-label={t('prints.fields.title')}>
      {own.map((field) => (
        <FieldRow key={field.path} field={field} used={usedSet} />
      ))}
      {catalog.loops.map((loop) => (
        <div key={loop.path} className="pr-loop" role="rowgroup">
          <div className="pr-frow pr-loop-head" role="row">
            <span role="cell">
              <span className="pr-tag">{`{#${loop.path}}…{/${loop.path}}`}</span>
            </span>
            <span role="cell" className="stack">
              <span>{loop.label}</span>
              <span className="small">{t('prints.fields.loop')}</span>
            </span>
            {usedSet && (
              <span role="cell" className="small">
                {usedSet.has(loop.path) ? t('prints.fields.used') : t('prints.fields.unused')}
              </span>
            )}
          </div>
          {loop.fields.map((field) => (
            <FieldRow key={field.path} field={field} used={usedSet} loop={loop.path} />
          ))}
        </div>
      ))}
      {common.length > 0 && (
        <>
          <div className="pr-catalog-sep small">{t('prints.fields.common')}</div>
          {common.map((field) => (
            <FieldRow key={field.path} field={field} used={usedSet} />
          ))}
        </>
      )}
    </div>
  );
}
