'use client';

/**
 * Wspólne elementy pozycji „Treści” (iteracja 7, makiety 28-panel-tresci): nagłówek z zakładkami i licznikami,
 * stany wpisów, komunikaty problemów treści z API (`422 CONTENT_VALIDATION_FAILED`, `details.issues[]`) i z parsera
 * Markdown w panelu, historia z dziennika audytu z „Przywróć” i adresy grafik z biblioteki mediów.
 */
import {
  contentSection,
  type ContentHistoryEntry,
  type ContentIssueView,
  type ContentSectionKey,
  type ContentStatus,
  type ListResponse,
  type MarkdownIssue,
  type MarkdownProfile,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, API_URL, ApiRequestError } from '../../../lib/api';
import { formatDate, formatDateTime, isToday, formatClock, t } from '../../../lib/i18n';

export const CONTENT_BASE = '/admin/tresci';
export const CONTENT_PATHS = {
  documents: CONTENT_BASE,
  blocks: `${CONTENT_BASE}/bloki`,
  faq: `${CONTENT_BASE}/faq`,
  news: `${CONTENT_BASE}/aktualnosci`,
  media: `${CONTENT_BASE}/media`,
  company: `${CONTENT_BASE}/firma`,
} as const;
type TabKey = keyof typeof CONTENT_PATHS;

/** Adres grafiki z biblioteki: widoki API podają adres względny `/media/{id}/{sha256}.{ext}` (ADR 0064). */
export const mediaUrl = (url: string) => `${API_URL}${url}`;

/** Długość jak w API: punkty kodowe, nie jednostki UTF-16 (licznik „168 / 240”). */
export const textLength = (text: string | null | undefined) => (text ? [...text].length : 0);

const total = (path: string) =>
  api<ListResponse<unknown>>(path)
    .then((r) => r.total)
    .catch(() => null);

/** Liczniki zakładek: dokumenty, sekcje z rejestru, pytania, aktualności i grafiki. */
function useTabCounts() {
  const [counts, setCounts] = useState<Partial<Record<TabKey, number | null>>>({});
  useEffect(() => {
    void Promise.all([
      api<unknown[]>('/admin/legal-documents')
        .then((r) => r.length)
        .catch(() => null),
      api<unknown[]>('/admin/content-sections')
        .then((r) => r.length)
        .catch(() => null),
      total('/admin/faq-items?pageSize=10'),
      total('/admin/news?pageSize=10'),
      total('/admin/media?pageSize=10'),
    ]).then(([documents, blocks, faq, news, media]) => setCounts({ documents, blocks, faq, news, media }));
  }, []);
  return counts;
}

/** Zakładki „Treści”: Dokumenty prawne, Bloki treści, FAQ, Aktualności, Media, Dane firmy (`content.read`). */
export function ContentTabs() {
  const pathname = usePathname();
  const counts = useTabCounts();
  const tabs: TabKey[] = ['documents', 'blocks', 'faq', 'news', 'media', 'company'];
  // Dokumenty prawne są pod adresem bazowym (i `/wersje/{id}`), pozostałe zakładki mają własne ścieżki.
  const active = tabs.slice(1).find((key) => pathname.startsWith(CONTENT_PATHS[key])) ?? 'documents';
  return (
    <nav className="tabs" aria-label={t('admin.nav.content')}>
      {tabs.map((key) => (
        <Link key={key} href={CONTENT_PATHS[key]} className="tab" aria-current={key === active ? 'page' : undefined}>
          {t.dynamic(`content.tabs.${key}`)}
          {counts[key] != null && <span className="n num">{counts[key]}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Nagłówek ekranów „Treści” z miejscem na wyszukiwarkę i przycisk dodawania (makiety 28-panel-tresci). */
export function ContentHead({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('content.title')}</h1>
          <div className="sub">{t('content.lead')}</div>
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      <ContentTabs />
    </>
  );
}

const STATUS_CLASS: Record<ContentStatus, string> = {
  DRAFT: 'pill warn',
  PUBLISHED: 'pill accent',
  ARCHIVED: 'pill muted',
};

export function StatusPill({ status, plural }: { status: ContentStatus; plural?: boolean }) {
  return (
    <span className={STATUS_CLASS[status]}>
      {t.dynamic(plural ? `content.statusPlural.${status}` : `content.status.${status}`)}
    </span>
  );
}

/** Nazwa sekcji z rejestru („Hero”, „Zasady przed jazdą”) i jej opis („strona główna, pierwszy ekran”). */
export const sectionName = (key: string) =>
  t.has(`content.sections.${key}.name`) ? t.dynamic(`content.sections.${key}.name`) : key;
export const sectionDescription = (key: string) =>
  t.has(`content.sections.${key}.description`) ? t.dynamic(`content.sections.${key}.description`) : '';

/** „dziś, 10:12” albo „14 lis” (kolumna „Zmieniono”). */
export const changedAt = (iso: string) =>
  isToday(iso) ? t('content.today', { time: formatClock(iso) }) : formatDate(iso);

/** Dozwolona składnia w profilu (podpowiedź nad edytorem i w komunikacie błędu). */
export const profileHint = (profile: MarkdownProfile) => t.dynamic(`content.profiles.${profile}`);

interface IssueContext {
  /** Sekcja, której dotyczy problem (komunikat „nie jest dozwolony w sekcji Hero”). */
  section?: ContentSectionKey;
  profile?: MarkdownProfile;
  /** Elementy sekcji-listy numerujemy od 1 (pozycja na liście w edytorze). */
  withItem?: boolean;
}

function issueValues(issue: Partial<ContentIssueView> & { code: string }, ctx: IssueContext) {
  const field =
    issue.field && t.has(`content.fields.${issue.field}`)
      ? t.dynamic(`content.fields.${issue.field}`)
      : (issue.field ?? '');
  const construct =
    issue.construct && t.has(`content.constructs.${issue.construct}`)
      ? t.dynamic(`content.constructs.${issue.construct}`)
      : (issue.construct ?? '');
  return {
    field,
    construct,
    section: ctx.section ? sectionName(ctx.section) : t('content.thisSection'),
    allowed: ctx.profile ? profileHint(ctx.profile) : '',
    max: issue.max ?? 0,
    length: issue.length ?? 0,
    min: issue.min ?? 0,
    count: issue.count ?? 0,
    minWidth: issue.minWidth ?? 0,
    width: issue.width ?? 0,
    line: issue.line ?? 0,
    column: issue.column ?? 0,
  };
}

/**
 * Komunikat problemu treści: błąd Markdown z wierszem („Wiersz 4: nagłówek nie jest dozwolony w sekcji Hero …”),
 * limit znaków, wymagane pole, za wąska grafika. Kod bez tłumaczenia pokazuje komunikat ogólny z kodem.
 */
export function issueMessage(issue: Partial<ContentIssueView> & { code: string }, ctx: IssueContext = {}): string {
  const values = issueValues(issue, ctx);
  let text: string;
  if (issue.code === 'MD_NOT_ALLOWED' && issue.construct && t.has(`content.notAllowed.${issue.construct}`)) {
    text = t('content.issues.MD_NOT_ALLOWED', { ...values, what: t.dynamic(`content.notAllowed.${issue.construct}`) });
  } else if (t.has(`content.issues.${issue.code}`)) {
    text = t.dynamic(`content.issues.${issue.code}`, values);
  } else if (t.has(`error.${issue.code}`)) {
    text = t.dynamic(`error.${issue.code}`);
  } else {
    text = t('error.unknown', { code: issue.code });
  }
  if (issue.line) text = t('content.issues.atLine', { line: issue.line, text });
  if (ctx.withItem && typeof issue.item === 'number') text = t('content.issues.atItem', { item: issue.item + 1, text });
  return text;
}

/** Problemy z odpowiedzi `422 CONTENT_VALIDATION_FAILED` (puste dla innych błędów). */
export function apiIssues(error: unknown): ContentIssueView[] {
  if (!(error instanceof ApiRequestError) || error.code !== 'CONTENT_VALIDATION_FAILED') return [];
  const details = error.details as { issues?: ContentIssueView[] } | null | undefined;
  return Array.isArray(details?.issues) ? details.issues : [];
}

/** Błędy parsera jako problemy pola (te same komunikaty co z API). */
export const markdownIssues = (
  issues: MarkdownIssue[],
  field: string,
  item: number | null = null,
): ContentIssueView[] => issues.map((issue) => ({ ...issue, field, item }));

export function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={value > max ? 'cnt over num' : 'cnt num'}>
      <b>{value}</b> / {max}
    </span>
  );
}

/** Historia wpisu z dziennika audytu (`GET …/history`); `revision` wymusza odświeżenie po zapisie. */
export function useContentHistory(path: string | null, revision: unknown) {
  const [entries, setEntries] = useState<ContentHistoryEntry[] | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<ContentHistoryEntry[]>(path)
      .then((r) => alive && setEntries(r))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return entries;
}

/** Kto i kiedy: „Joanna Lis” albo „Dane startowe” dla wpisu systemu. */
export const historyWho = (entry: ContentHistoryEntry) =>
  entry.system ? t('content.history.seed') : (entry.staffName ?? t('audit.system'));

/**
 * Lista historii (makieta tresci-blok-edycja): wersja, autor, data i „Przywróć” dla wpisów z pełnym stanem.
 * Najnowszy wpis to wersja obecna. Przywrócenie wczytuje stan do edytora; zapis tworzy nową wersję.
 */
export function HistoryList({
  entries,
  onRestore,
  canRestore,
  limit = 6,
}: {
  entries: ContentHistoryEntry[] | null;
  onRestore: (entry: ContentHistoryEntry) => void;
  canRestore: boolean;
  limit?: number;
}) {
  if (entries === null) return <span className="skeleton" style={{ width: '60%' }} />;
  if (entries.length === 0) return <p className="small">{t('history.empty')}</p>;
  return (
    <ol className="ct-history">
      {entries.slice(0, limit).map((entry, i) => (
        <li key={entry.auditId}>
          <span className="ct-hv num">
            {entry.versionTo !== null ? t('content.history.version', { version: entry.versionTo }) : ''}
          </span>
          <span className="ct-hwho">
            <b>{historyWho(entry)}</b>
            <small>
              {formatDateTime(entry.createdAt)}
              {i === 0
                ? ` · ${t('content.history.current')}`
                : entry.restoredFrom !== null
                  ? ` · ${t('content.history.restored')}`
                  : ''}
            </small>
          </span>
          {i > 0 && canRestore && entry.after && (
            <button type="button" className="link" onClick={() => onRestore(entry)}>
              {t('content.history.restore')}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** „1,8 MB”, „640 KB”. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return t('content.media.mb', { value: bytes / (1024 * 1024) });
  return t('content.media.kb', { value: Math.max(1, Math.round(bytes / 1024)) });
}

/** Rodzaj sekcji: „Pojedynczy blok”, „Lista · 3 z 3–4”. */
export function sectionKind(key: ContentSectionKey, items?: number): string {
  const def = contentSection(key);
  if (def.kind === 'single') return t('content.blocks.single');
  const { min, max } = def.items ?? { min: 0, max: 0 };
  return t('content.blocks.list', { count: items ?? 0, range: min === max ? String(max) : `${min}–${max}` });
}
