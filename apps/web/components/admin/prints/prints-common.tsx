'use client';

/**
 * Wspólne elementy pozycji „Wydruki” (iteracja 7, ADR 0066–0068, makiety 29-panel-wydruki): nagłówek z zakładkami
 * Szablony (`templates.read`) i Wygenerowane (`documents.generate`), katalog rodzajów z API
 * (`GET /admin/document-types`, jedno źródło „Drukuj” na kartach obiektów), nazwy rodzajów, rozmiary plików
 * i pobieranie plików wydruku przez adres z podpisem (ADR 0057).
 */
import type {
  DocumentFileLink,
  DocumentType,
  DocumentTypeView,
  GeneratedDocumentView,
  ListResponse,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, fileUrl } from '../../../lib/api';
import { formatClock, formatDate, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

export const PRINTS_BASE = '/admin/wydruki';
export const PRINTS_PATHS = {
  templates: PRINTS_BASE,
  generated: `${PRINTS_BASE}/wygenerowane`,
  template: (id: string) => `${PRINTS_BASE}/szablony/${id}`,
} as const;

/** Kolejność rodzajów na liście szablonów (makieta wydruki-szablony). */
export const TEMPLATE_TYPE_ORDER = [
  'RECEIPT',
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
] as const;

/** Rodzaje z danymi klienta: bez `users.read` wydruk wstawia „Klient” (ADR 0068). */
export const CUSTOMER_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set([
  'RECEIPT',
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
]);

export const typeName = (type: DocumentType) => t.dynamic(`prints.types.${type}.name`);

/** „48 KB”, „1,2 MB”. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return t('prints.size.kb', { value: Math.max(1, Math.round(bytes / 1024)) });
  return t('prints.size.mb', { value: bytes / 1024 / 1024 });
}

/** „dziś, 14:22” albo „18 paź, 15:10”. */
export function formatWhen(iso: string): string {
  return isToday(iso)
    ? t('prints.when.today', { time: formatClock(iso) })
    : t('prints.when.date', { date: formatDate(iso), time: formatClock(iso) });
}

/** Identyfikator wydruku ze stopki: pierwsze 8 znaków (ADR 0068). */
export const shortId = (id: string) => id.slice(0, 8);

// ---------------------------------------------------------------------------------------------
// Katalog rodzajów z API
// ---------------------------------------------------------------------------------------------

let typesRequest: Promise<DocumentTypeView[]> | null = null;
const typesListeners = new Set<() => void>();

/** Rodzaje z szablonami (wspólne dla wszystkich przycisków „Drukuj” na ekranie). */
export function loadDocumentTypes(): Promise<DocumentTypeView[]> {
  typesRequest ??= api<DocumentTypeView[]>('/admin/document-types').catch((error: unknown) => {
    typesRequest = null;
    throw error;
  });
  return typesRequest;
}

/** Po zmianie szablonów (aktywacja, domyślny, nowy szablon) „Drukuj” liczy widoczność od nowa. */
export function invalidateDocumentTypes(): void {
  typesRequest = null;
  typesListeners.forEach((listener) => listener());
}

export function useDocumentTypes(enabled: boolean): DocumentTypeView[] | null {
  const [types, setTypes] = useState<DocumentTypeView[] | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((n) => n + 1);
    typesListeners.add(listener);
    return () => void typesListeners.delete(listener);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    loadDocumentTypes()
      .then((list) => current && setTypes(list))
      .catch(() => current && setTypes([]));
    return () => {
      current = false;
    };
  }, [enabled, revision]);
  return enabled ? types : null;
}

/** Rodzaj, który operator może wydrukować (`printable`: uprawnienia i szablon z aktywną wersją albo naklejka). */
export function usePrintableType(documentType: DocumentType): DocumentTypeView | null {
  const { can } = useSession();
  const types = useDocumentTypes(can('documents.generate'));
  const type = types?.find((item) => item.documentType === documentType);
  return type?.printable ? type : null;
}

// ---------------------------------------------------------------------------------------------
// Pliki
// ---------------------------------------------------------------------------------------------

/** Zapis pliku z pamięci (podgląd PDF, „Lista pól (DOCX)”) pod podaną nazwą. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Adres z podpisem jest ważny 10 min; z zapasem minuty traktujemy go jak wygasły. */
export const linkFresh = (link: DocumentFileLink | null | undefined): link is DocumentFileLink =>
  Boolean(link && new Date(link.urlExpiresAt).getTime() - Date.now() > 60_000);

/**
 * Pobranie pliku wydruku: świeży adres z `GET /admin/documents/{id}` (podpis 10 min). PDF API podaje `inline`,
 * więc otwiera się w nowej karcie (otwartej od razu, żeby przeglądarka nie zablokowała okna); DOCX ma
 * `attachment` i pobiera się bez opuszczania panelu.
 */
export async function openDocumentFile(
  id: string,
  kind: 'pdf' | 'docx',
  known?: DocumentFileLink | null,
): Promise<void> {
  const tab = kind === 'pdf' ? window.open('', '_blank') : null;
  try {
    const link = linkFresh(known) ? known : (await api<GeneratedDocumentView>(`/admin/documents/${id}`)).files[kind];
    if (!link) throw new Error('FILE_DELETED');
    if (tab) tab.location.href = fileUrl(link.url);
    else window.location.assign(fileUrl(link.url));
  } catch (error) {
    tab?.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Nagłówek i zakładki
// ---------------------------------------------------------------------------------------------

const total = (path: string) =>
  api<ListResponse<unknown>>(path)
    .then((r) => r.total)
    .catch(() => null);

/** Zakładki z liczbami (makieta): Szablony z `templates.read`, Wygenerowane z `documents.generate`. */
export function PrintsTabs({ revision = 0 }: { revision?: number }) {
  const pathname = usePathname();
  const { can } = useSession();
  const templates = can('templates.read');
  const generated = can('documents.generate');
  const [counts, setCounts] = useState<{ templates: number | null; generated: number | null }>({
    templates: null,
    generated: null,
  });
  useEffect(() => {
    void Promise.all([
      templates ? total('/admin/document-templates?pageSize=10') : Promise.resolve(null),
      generated ? total('/admin/generated-documents?pageSize=10') : Promise.resolve(null),
    ]).then(([templateCount, generatedCount]) => setCounts({ templates: templateCount, generated: generatedCount }));
  }, [templates, generated, revision]);
  const tabs = [
    ...(templates
      ? [{ href: PRINTS_PATHS.templates, label: t('prints.tabs.templates'), count: counts.templates }]
      : []),
    ...(generated
      ? [{ href: PRINTS_PATHS.generated, label: t('prints.tabs.generated'), count: counts.generated }]
      : []),
  ];
  const active = pathname.startsWith(PRINTS_PATHS.generated) ? PRINTS_PATHS.generated : PRINTS_PATHS.templates;
  return (
    <nav className="tabs" aria-label={t('admin.nav.prints')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.href === active ? 'page' : undefined}>
          {tab.label}
          {tab.count !== null && <span className="n num">{t('prints.tabs.count', { count: tab.count })}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Tytuł „Wydruki” z opisem i przyciskami po prawej (makiety wydruki-szablony i wydruki-wygenerowane). */
export function PrintsHead({ actions }: { actions?: ReactNode }) {
  return (
    <div className="page-head pr-head">
      <div>
        <h1>{t('prints.title')}</h1>
        <div className="sub">{t('prints.subtitle')}</div>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Natywny `<dialog>` otwierany przy montowaniu (fokus i Escape z przeglądarki). */
export function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return ref;
}
