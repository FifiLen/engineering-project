'use client';

/**
 * Szablony powiadomień (iteracja 6, ADR 0058, makieta szablony-powiadomien): lista kodów z rejestru, edytor treści
 * ICU z numeracją wierszy, walidacja w API przy każdej zmianie (problem z wierszem i znakiem), parametry podglądu,
 * podgląd na ekranie blokady z ostatniej poprawnej treści, zapis jako nowa wersja i przywrócenie starszej wersji.
 * Bez `content.write` edytor jest tylko do odczytu.
 */
import {
  TEMPLATE_LIMITS,
  type ListResponse,
  type NotificationTemplateDetails,
  type NotificationTemplateListItem,
  type NotificationTemplatePreviewResult,
  type TemplateIssueView,
  type TemplateParam,
} from '@hulajnogi/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatClock, formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { ConfirmDialog } from '../confirm-dialog';
import { AlertIcon, BrandMark, SearchIcon } from '../icons';
import { CodeEditor } from './code-editor';
import { NotificationsTabs } from './notification-lists';

type Values = Record<string, string | number | boolean>;

/** Przykładowe liczby do podglądu; teksty przykładowe są w pliku tłumaczeń (`notifications.samples`). */
const NUMBER_SAMPLES: Record<string, number> = { minutes: 24, minutesLeft: 2, batteryPct: 15 };
/** Szybkie wartości liczby: formy odmiany (jedna, kilka, wiele). */
const QUICK_NUMBERS = [1, 3, 5, 22];
/** Parametry z kwotą sformatowaną przez API. */
const MONEY_PARAMS = new Set(['amount', 'towingFee']);

function sampleValues(params: readonly TemplateParam[]): Values {
  const values: Values = {};
  for (const p of params) {
    if (p.type === 'number') values[p.name] = NUMBER_SAMPLES[p.name] ?? 1;
    else if (p.type === 'select') values[p.name] = p.options?.[0] ?? '';
    else
      values[p.name] = t.has(`notifications.samples.${p.name}`) ? t.dynamic(`notifications.samples.${p.name}`) : p.name;
  }
  return values;
}

/** „Wiersz 5, znak 42: brak „}” …”; problem bez położenia bez przedrostka. */
export function issueMessage(issue: TemplateIssueView): string {
  const values = {
    param: issue.param ?? '',
    option: issue.option ?? '',
    max: issue.max ?? 0,
    length: issue.length ?? 0,
    field: t.dynamic(`notifications.editor.fields.${issue.field}`),
  };
  let text: string;
  if (issue.code === 'TEMPLATE_SYNTAX_ERROR' && issue.kind && t.has(`notifications.syntax.${issue.kind}`)) {
    text = t.dynamic(`notifications.syntax.${issue.kind}`);
  } else if (t.has(`notifications.issues.${issue.code}`)) {
    text = t.dynamic(`notifications.issues.${issue.code}`, values);
  } else {
    text = t.has(`error.${issue.code}`) ? t.dynamic(`error.${issue.code}`) : issue.code;
  }
  return issue.line ? t('notifications.issues.at', { line: issue.line, column: issue.column ?? 1, text }) : text;
}

const len = (text: string) => [...text].length;

export function TemplatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<NotificationTemplateListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    api<ListResponse<NotificationTemplateListItem>>('/admin/notification-templates?pageSize=100')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setListError(errorMessage(e)));
  }, [revision]);

  const code = searchParams.get('kod');
  const selected = items?.find((i) => i.code === code) ?? items?.[0] ?? null;
  const select = (next: string) => {
    if (next === selected?.code) return;
    if (dirty) setPending(next);
    else router.replace(`${pathname}?kod=${encodeURIComponent(next)}`, { scroll: false });
  };
  const q = search.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (i) => !q || i.code.includes(q) || (i.title ?? '').toLowerCase().includes(q) || i.body.toLowerCase().includes(q),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('resource.notification-templates.title')}</h1>
          <div className="sub">{t('notifications.subtitle')}</div>
        </div>
        <div className="actions">
          <label className="search narrow">
            <SearchIcon />
            <span className="visually-hidden">{t('list.search')}</span>
            <input
              type="search"
              value={search}
              placeholder={t('resource.notification-templates.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>
      <NotificationsTabs />
      {listError && <Banner kind="danger">{listError}</Banner>}

      <div className="tpl-layout">
        <section className="card tpl-list" aria-label={t('notifications.tabs.templates')}>
          {items === null && !listError && <span className="skeleton" style={{ width: '70%', margin: 14 }} />}
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className="tpl"
              aria-current={item.id === selected?.id ? 'true' : undefined}
              onClick={() => select(item.code)}
            >
              <span className="tpl-top">
                <span className="tpl-code">{item.code}</span>
                <span className={item.channel === 'SMS' ? 'pill sm muted' : 'pill sm'}>
                  {t.dynamic(`resource.notification-templates.values.channel.${item.channel}`)}
                </span>
                {item.id === selected?.id && dirty ? (
                  <span className="tpl-dot" aria-label={t('notifications.editor.unsaved')} role="img" />
                ) : (
                  <span className="small tpl-ver">{t('notifications.versionShort', { version: item.version })}</span>
                )}
              </span>
              <span className="small tpl-title">
                {item.title ?? <span className="muted">{t('notifications.noTitle')}</span>}
              </span>
            </button>
          ))}
          {items && shown.length === 0 && <p className="small tpl-note">{t('list.noResultsTitle')}</p>}
          <p className="small tpl-note">{t('notifications.registryNote')}</p>
        </section>

        {selected && (
          <TemplateEditor
            key={selected.id}
            id={selected.id}
            onDirty={setDirty}
            onSaved={() => setRevision((n) => n + 1)}
          />
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        danger
        title={t('notifications.discard.title')}
        body={t('notifications.discard.body')}
        action={t('notifications.discard.action')}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          setDirty(false);
          if (next) router.replace(`${pathname}?kod=${encodeURIComponent(next)}`, { scroll: false });
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}

interface EditorProps {
  id: string;
  onDirty: (dirty: boolean) => void;
  /** Nowa wersja zapisana albo przywrócona: lista po lewej odświeża numer wersji. */
  onSaved: () => void;
}

function TemplateEditor({ id, onDirty, onSaved }: EditorProps) {
  const { can } = useSession();
  const canWrite = can('content.write');
  const [template, setTemplate] = useState<NotificationTemplateDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [values, setValues] = useState<Values>({});
  const [preview, setPreview] = useState<NotificationTemplatePreviewResult | null>(null);
  /** Ostatnia poprawna treść po renderowaniu i to, czy pochodzi z bieżącej treści w edytorze. */
  const [lastValid, setLastValid] = useState<{ title: string | null; body: string; current: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restore, setRestore] = useState<number | null>(null);

  const apply = (next: NotificationTemplateDetails) => {
    setTemplate(next);
    setTitle(next.title ?? '');
    setBody(next.body);
  };

  useEffect(() => {
    api<NotificationTemplateDetails>(`/admin/notification-templates/${id}`)
      .then((next) => {
        apply(next);
        setValues(sampleValues(next.params));
      })
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [id]);

  const sms = template?.channel === 'SMS';
  const dirty = template !== null && (title !== (template.title ?? '') || body !== template.body);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // Walidacja i podgląd w API po krótkiej przerwie w pisaniu (te same reguły co przy zapisie).
  useEffect(() => {
    if (!template) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<NotificationTemplatePreviewResult>(`/admin/notification-templates/${id}/preview`, {
        method: 'POST',
        json: { title: sms ? null : title, body, values },
        signal: controller.signal,
      })
        .then((result) => {
          setPreview(result);
          setLastValid((prev) =>
            result.rendered ? { ...result.rendered, current: true } : prev && { ...prev, current: false },
          );
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, template, sms, title, body, values]);

  const issues = preview?.issues ?? [];
  const titleIssues = issues.filter((i) => i.field === 'title');
  const bodyIssues = issues.filter((i) => i.field === 'body');
  const badLines = new Set(bodyIssues.flatMap((i) => (i.line ? [i.line] : [])));
  const hasSyntax = issues.some((i) => i.code === 'TEMPLATE_SYNTAX_ERROR');

  const save = async () => {
    if (!template) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<NotificationTemplateDetails>(`/admin/notification-templates/${id}`, {
        method: 'PATCH',
        json: { version: template.version, title: sms ? null : title, body },
      });
      apply(next);
      setNotice(t('notifications.editor.saved', { version: next.version }));
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.code === 'CONFLICT' ? t('notifications.editor.conflict') : errorMessage(e),
      );
    } finally {
      setSaving(false);
    }
  };

  const doRestore = async (fromVersion: number) => {
    setRestore(null);
    if (!template) return;
    setError(null);
    try {
      const next = await api<NotificationTemplateDetails>(`/admin/notification-templates/${id}/restore`, {
        method: 'POST',
        json: { version: template.version, fromVersion },
      });
      apply(next);
      setNotice(t('notifications.history.restored', { from: fromVersion, version: next.version }));
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (loadError) return <Banner kind="danger">{loadError}</Banner>;
  if (!template) return <section className="card tpl-editor" aria-busy="true" />;

  const bodyMax = sms ? TEMPLATE_LIMITS.smsBody : TEMPLATE_LIMITS.body;
  const footerHint = !canWrite
    ? t('notifications.editor.readOnlyHint')
    : hasSyntax
      ? t('notifications.editor.fixSyntax')
      : issues.length
        ? t('notifications.editor.fixIssues')
        : dirty
          ? t('notifications.editor.appliesNext')
          : t('notifications.editor.noChanges');

  return (
    <section className="card tpl-editor" aria-label={template.code}>
      <div className="tpl-head">
        <span className="tpl-name">{template.code}</span>
        <span className={sms ? 'pill muted' : 'pill'}>
          {t.dynamic(`resource.notification-templates.values.channel.${template.channel}`)}
        </span>
        {dirty && <span className="pill accent">{t('notifications.editor.unsaved')}</span>}
        {!canWrite && <span className="pill muted">{t('notifications.editor.readOnly')}</span>}
        <span className="small tpl-meta">
          {t('notifications.editor.meta', {
            version: template.version,
            who: template.updatedByName ?? t('notifications.history.seed'),
            when: formatDateTime(template.updatedAt),
          })}
        </span>
      </div>
      <p className="small tpl-desc">
        {[
          template.description,
          t('notifications.editor.params', { params: template.params.map((p) => p.name).join(', ') }),
        ]
          .filter(Boolean)
          .join(' ')}
      </p>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {error && <Banner kind="danger">{error}</Banner>}

      <div className="tpl-grid">
        <div className="tpl-main">
          {!sms && (
            <div className="field">
              <span className="tpl-label-row">
                <label className="label" htmlFor="tpl-title">
                  {t('notifications.editor.fields.title')}
                </label>
                <span className="small">
                  <span className="num ink">{len(title)}</span>
                  {t('notifications.editor.of', { max: TEMPLATE_LIMITS.title })}
                </span>
              </span>
              <input
                id="tpl-title"
                className="input"
                value={title}
                readOnly={!canWrite}
                aria-invalid={titleIssues.length > 0}
                onChange={(e) => setTitle(e.target.value)}
              />
              {titleIssues.map((issue, i) => (
                <span key={i} className="err">
                  <AlertIcon size={14} />
                  {issueMessage(issue)}
                </span>
              ))}
            </div>
          )}
          <div className="field">
            <span className="tpl-label-row">
              <label className="label" htmlFor="tpl-body">
                {t('notifications.editor.fields.body')} <span className="opt">{t('notifications.editor.icu')}</span>
              </label>
              <span className="small">
                <span className="num ink">{len(body)}</span>
                {t('notifications.editor.of', { max: bodyMax })}
              </span>
            </span>
            <CodeEditor
              id="tpl-body"
              value={body}
              onChange={setBody}
              badLines={badLines}
              invalid={bodyIssues.length > 0}
              readOnly={!canWrite}
              label={t('notifications.editor.bodyLabel')}
              describedBy={bodyIssues.length ? 'tpl-body-issues' : undefined}
            />
            <span id="tpl-body-issues" className="tpl-issues">
              {bodyIssues.map((issue, i) => (
                <span key={i} className="err">
                  <AlertIcon size={14} />
                  {issueMessage(issue)}
                </span>
              ))}
            </span>
          </div>

          {template.params.length > 0 && (
            <div className="tpl-params">
              <div className="tpl-label-row">
                <span className="label">{t('notifications.params.title')}</span>
                <span className="small">{t('notifications.params.hint')}</span>
              </div>
              {template.params.map((p) => (
                <ParamRow
                  key={p.name}
                  param={p}
                  value={values[p.name]}
                  onChange={(v) => setValues((prev) => ({ ...prev, [p.name]: v }))}
                />
              ))}
            </div>
          )}
        </div>

        <div className="tpl-side">
          <div className="tpl-label-row">
            <span className="label">{t('notifications.preview.title')}</span>
            <span className="small">
              {lastValid
                ? lastValid.current
                  ? t('notifications.preview.current')
                  : t('notifications.preview.lastValid')
                : t('common.none')}
            </span>
          </div>
          <LockScreen rendered={lastValid} sms={sms} />

          <div>
            <div className="tpl-label-row">
              <span className="label">{t('notifications.history.title')}</span>
              <span className="small">{t('notifications.history.hint')}</span>
            </div>
            {template.versions.map((v) => (
              <div key={v.version} className="hv">
                <span className="num">{t('notifications.versionShort', { version: v.version })}</span>
                <span className="stack grow">
                  <span>{v.staffName ?? t('notifications.history.seed')}</span>
                  <span className="small">
                    {formatDateTime(v.createdAt)}
                    {v.current && ` · ${t('notifications.history.current')}`}
                  </span>
                </span>
                {!v.current && canWrite && (
                  <button type="button" className="link-btn" onClick={() => setRestore(v.version)}>
                    {t('notifications.history.restore')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tpl-foot">
        {canWrite && (
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => {
              setTitle(template.title ?? '');
              setBody(template.body);
            }}
          >
            {t('notifications.editor.discard')}
          </button>
        )}
        <span className="small tpl-foot-hint">{footerHint}</span>
        {canWrite && (
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || saving || issues.length > 0 || preview === null}
            onClick={() => void save()}
          >
            {t('notifications.editor.save', { version: template.version + 1 })}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={restore !== null}
        title={t('notifications.history.restoreTitle', { version: restore ?? 0 })}
        body={t('notifications.history.restoreBody', { next: template.version + 1 })}
        action={t('notifications.history.restore')}
        onConfirm={() => restore !== null && void doRestore(restore)}
        onClose={() => setRestore(null)}
      />
    </section>
  );
}

/** Wiersz „Parametry podglądu”: tekst, liczba z szybkimi wartościami odmiany albo wybór (przełącznik dla tak/nie). */
function ParamRow({
  param,
  value,
  onChange,
}: {
  param: TemplateParam;
  value: string | number | boolean | undefined;
  onChange: (value: string | number) => void;
}) {
  const inputId = `prm-${param.name}`;
  const boolean = param.type === 'select' && param.options?.length === 2 && param.options.includes('true');
  const kind = MONEY_PARAMS.has(param.name) ? 'money' : boolean ? 'boolean' : param.type;
  return (
    <div className="prm">
      <label className="prm-name" htmlFor={inputId}>
        {param.name}
      </label>
      <span className="prm-input">
        {param.type === 'number' && (
          <>
            <input
              id={inputId}
              className="mini"
              inputMode="numeric"
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            />
            {QUICK_NUMBERS.map((n) => (
              <button key={n} type="button" className="qc" aria-pressed={value === n} onClick={() => onChange(n)}>
                {n}
              </button>
            ))}
          </>
        )}
        {param.type === 'text' && (
          <input
            id={inputId}
            className="mini wide"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {boolean && (
          <label className="switch">
            <input
              id={inputId}
              type="checkbox"
              checked={value === 'true'}
              onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            />
            <span className="code ink">{String(value)}</span>
          </label>
        )}
        {param.type === 'select' && !boolean && (
          <select
            id={inputId}
            className="mini wide"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          >
            {(param.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </span>
      <span className="small">{t.dynamic(`notifications.params.kind.${kind}`)}</span>
    </div>
  );
}

/** Podgląd na ekranie blokady telefonu (push) albo w wiadomości (SMS). */
function LockScreen({ rendered, sms }: { rendered: { title: string | null; body: string } | null; sms: boolean }) {
  const [now] = useState(() => new Date().toISOString());
  return (
    <div className="lock" aria-label={t('notifications.preview.label')} role="img">
      <span className="lock-time num">{formatClock(now)}</span>
      <div className="notif">
        <span className="notif-icon" aria-hidden="true">
          <BrandMark size={18} />
        </span>
        <span className="stack grow">
          <span className="notif-top">
            <span>{sms ? t('notifications.preview.sms') : t('admin.brand')}</span>
            <span>{t('notifications.preview.now')}</span>
          </span>
          {rendered?.title && <span className="notif-title">{rendered.title}</span>}
          <span className="notif-body">{rendered ? rendered.body : t('notifications.preview.empty')}</span>
        </span>
      </div>
    </div>
  );
}
