'use client';

/**
 * Raporty → Definicje (`reports.manage`, ADR 0071, makieta raport-definicja): lista definicji w kolejności katalogu
 * z przeciąganiem (i strzałkami z klawiatury), formularz nazwy, opisu, aktywności i kolejności z blokadą optymistyczną
 * (`version`, konflikt `409 CONFLICT`), blok „Z kodu” tylko do odczytu (kod, uprawnienie z rolami, formaty, sekcje,
 * parametry) i historia zmian z dziennika audytu (wpisy `report_definition.*` z kodem definicji).
 */
import type {
  AuditLogDetails,
  AuditLogListItem,
  ListResponse,
  ReportCode,
  ReportDefinitionDetails,
  ReportDefinitionListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { api, ApiRequestError } from '../../../lib/api';
import { formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { GripIcon, LockIcon } from '../icons';
import { invalidateReportCatalog, reportErrorMessage, REPORTS_PATHS, ReportsHead, ReportsTabs } from './reports-common';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;

type Definition = ReportDefinitionListItem;

export function ReportDefinitionsPage({ code }: { code?: string }) {
  const router = useRouter();
  const { can } = useSession();
  const allowed = can('reports.manage');
  const [list, setList] = useState<Definition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(() => {
    api<ListResponse<Definition>>('/admin/report-definitions?pageSize=100')
      .then((r) => {
        setList(r.items);
        setError(null);
      })
      .catch((e: unknown) => setError(reportErrorMessage(e)));
  }, []);
  useEffect(() => {
    if (allowed) load();
  }, [allowed, load, revision]);

  const selected = list ? (list.find((d) => d.code === code) ?? list[0] ?? null) : null;
  useEffect(() => {
    if (!code && selected) router.replace(REPORTS_PATHS.definition(selected.code), { scroll: false });
  }, [code, selected, router]);

  if (!allowed) {
    return (
      <>
        <ReportsHead />
        <ReportsTabs />
        <Banner kind="danger">{t('reports.definitions.forbidden')}</Banner>
      </>
    );
  }

  const changed = (text: string) => {
    setNotice({ text, error: false });
    invalidateReportCatalog();
    setRevision((n) => n + 1);
  };

  return (
    <>
      <ReportsHead />
      <ReportsTabs revision={revision} />
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind={notice.error ? 'danger' : 'ok'}>{notice.text}</Banner>}
      <div className="rp-defs">
        <DefinitionList
          list={list}
          selected={selected?.code ?? null}
          onReordered={() => changed(t('reports.definitions.reordered'))}
          onError={(text) => setNotice({ text, error: true })}
        />
        {selected && (
          <DefinitionDetails
            key={`${selected.code}:${selected.version}`}
            code={selected.code}
            list={list ?? []}
            onSaved={() => changed(t('reports.definitions.saved', { name: selected.name }))}
            onError={(text) => setNotice({ text, error: true })}
          />
        )}
      </div>
    </>
  );
}

/** Kolejność całej listy jednym poleceniem (`POST /admin/report-definitions/reorder` z wersjami). */
async function reorder(items: Definition[]): Promise<void> {
  await api('/admin/report-definitions/reorder', {
    method: 'POST',
    json: { items: items.map((d) => ({ code: d.code, version: d.version })) },
  });
}

function DefinitionList({
  list,
  selected,
  onReordered,
  onError,
}: {
  list: Definition[] | null;
  selected: string | null;
  onReordered: () => void;
  onError: (text: string) => void;
}) {
  const [order, setOrder] = useState<Definition[] | null>(list);
  const [dragging, setDragging] = useState<ReportCode | null>(null);
  useEffect(() => setOrder(list), [list]);

  const commit = async (next: Definition[]) => {
    setOrder(next);
    try {
      await reorder(next);
      onReordered();
    } catch (e) {
      setOrder(list);
      onError(reportErrorMessage(e));
    }
  };
  const move = (from: number, to: number) => {
    if (!order || from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    void commit(next);
  };
  const onDrop = (e: DragEvent, target: number) => {
    e.preventDefault();
    if (!order || !dragging) return;
    move(
      order.findIndex((d) => d.code === dragging),
      target,
    );
    setDragging(null);
  };
  // Klawiatura: Alt + strzałka przesuwa definicję (przeciąganie bez myszy).
  const onKey = (e: KeyboardEvent, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    move(index, index + (e.key === 'ArrowUp' ? -1 : 1));
  };

  return (
    <section className="card rp-def-list" aria-labelledby="def-list-title">
      <div className="rp-card-head">
        <h2 className="rp-card-title" id="def-list-title">
          {t('reports.definitions.title')}
        </h2>
        <span className="small">{t('reports.definitions.order')}</span>
      </div>
      <ol className="rp-def-items">
        {order === null &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="rp-def-item" aria-hidden="true">
              <span className="skeleton" style={{ width: '60%' }} />
            </li>
          ))}
        {order?.map((d, i) => (
          <li
            key={d.code}
            className={[
              'rp-def-item',
              d.code === selected && 'on',
              !d.active && 'inactive',
              dragging === d.code && 'dragging',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', d.code);
              setDragging(d.code);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
          >
            <span className="rp-grip" aria-hidden="true">
              <GripIcon size={16} />
            </span>
            <span className="rp-def-pos num">{i + 1}</span>
            <Link
              href={REPORTS_PATHS.definition(d.code)}
              className="rp-def-link"
              aria-current={d.code === selected ? 'page' : undefined}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-description={t('reports.definitions.moveHint')}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="stack">
                <span className="strong-500">{d.name}</span>
                <span className="code">{d.code}</span>
              </span>
              {!d.active && <span className="pill sm muted">{t('reports.definitions.inactive')}</span>}
            </Link>
          </li>
        ))}
      </ol>
      <p className="small rp-def-note">{t('reports.definitions.note')}</p>
    </section>
  );
}

function DefinitionDetails({
  code,
  list,
  onSaved,
  onError,
}: {
  code: ReportCode;
  list: Definition[];
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [def, setDef] = useState<ReportDefinitionDetails | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [position, setPosition] = useState(1);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const index = list.findIndex((d) => d.code === code);

  const reset = useCallback(
    (d: ReportDefinitionDetails) => {
      setDef(d);
      setName(d.name);
      setDescription(d.description ?? '');
      setActive(d.active);
      setPosition(index + 1);
    },
    [index],
  );
  // Szczegóły wczytane raz na kod i wersję (klucz komponentu), więc odświeżenie rodzica nie kasuje zmian w formularzu.
  const first = useRef({ reset, onError });
  useEffect(() => {
    const { reset: apply, onError: fail } = first.current;
    api<ReportDefinitionDetails>(`/admin/report-definitions/${code}`)
      .then(apply)
      .catch((e: unknown) => fail(reportErrorMessage(e)));
  }, [code]);

  if (!def) {
    return (
      <section className="card rp-def-form" aria-busy="true">
        <span className="skeleton" style={{ width: '40%', height: 18 }} />
      </section>
    );
  }

  const nameValue = name.trim();
  const fieldsChanged =
    nameValue !== def.name || (description.trim() || null) !== (def.description ?? null) || active !== def.active;
  const positionChanged = position !== index + 1;
  const dirty = fieldsChanged || positionChanged;
  const invalid = nameValue.length === 0 || nameValue.length > NAME_MAX || description.trim().length > DESCRIPTION_MAX;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || invalid) return;
    setBusy(true);
    setConflict(false);
    try {
      if (fieldsChanged) {
        await api(`/admin/report-definitions/${code}`, {
          method: 'PATCH',
          json: {
            version: def.version,
            name: nameValue,
            description: description.trim() || null,
            active,
          },
        });
      }
      if (positionChanged) {
        // Wersje po zapisie pól: kolejność liczy się na świeżej liście.
        const fresh = (await api<ListResponse<Definition>>('/admin/report-definitions?pageSize=100')).items;
        const from = fresh.findIndex((d) => d.code === code);
        const next = [...fresh];
        const [moved] = next.splice(from, 1);
        next.splice(Math.min(Math.max(position - 1, 0), next.length), 0, moved!);
        await reorder(next);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') setConflict(true);
      else onError(reportErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="rp-def-main">
      <form className="card rp-def-form" onSubmit={(e) => void save(e)} aria-labelledby="def-title">
        <div className="rp-def-form-head">
          <div className="stack">
            <h2 id="def-title">{def.name}</h2>
            <span className="small">
              {t('reports.definitions.version', {
                version: def.version,
                date: formatDateTime(def.updatedAt),
                name: def.updatedByName ?? t('audit.system'),
              })}
            </span>
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled={!dirty || busy} onClick={() => reset(def)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn primary" disabled={!dirty || invalid || busy}>
              {t('common.save')}
            </button>
          </div>
        </div>

        {conflict && (
          <div className="banner danger" role="alert">
            <div>
              <b>{t('reports.definitions.conflictTitle')}</b>
              {t('reports.definitions.conflictBody')}
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={onSaved}>
                {t('reports.definitions.reload')}
              </button>
            </div>
          </div>
        )}

        <div className="rp-def-grid">
          <label className="field">
            <span className="label">{t('reports.definitions.fields.name')}</span>
            <span className="rp-input-wrap">
              <input
                className="input"
                value={name}
                maxLength={NAME_MAX}
                required
                aria-invalid={nameValue.length === 0}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="rp-counter num">
                {t('reports.definitions.counter', { count: name.length, max: NAME_MAX })}
              </span>
            </span>
            <span className="hint">{t('reports.definitions.hints.name')}</span>
          </label>
          <label className="field">
            <span className="label">{t('reports.definitions.fields.position')}</span>
            <span className="rp-input-wrap">
              <input
                className="input"
                type="number"
                min={1}
                max={list.length}
                value={position}
                onChange={(e) => setPosition(Math.max(1, Math.min(list.length, Number(e.target.value) || 1)))}
              />
              <span className="rp-counter num">{t('reports.definitions.of', { count: list.length })}</span>
            </span>
            <span className="hint">{t('reports.definitions.hints.position')}</span>
          </label>
        </div>

        <label className="field">
          <span className="label">{t('reports.definitions.fields.description')}</span>
          <textarea
            className="textarea"
            rows={3}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span className="rp-hint-row">
            <span className="hint">{t('reports.definitions.hints.description')}</span>
            <span className="hint num">
              {t('reports.definitions.counter', { count: description.length, max: DESCRIPTION_MAX })}
            </span>
          </span>
        </label>

        <label className="rp-active">
          <span className="rp-switch">
            <input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="rp-switch-track" aria-hidden="true" />
          </span>
          <span className="stack">
            <span className="strong-500">{t('reports.definitions.fields.active')}</span>
            <span className="small">{t('reports.definitions.hints.active')}</span>
          </span>
        </label>
      </form>

      <div className="rp-def-bottom">
        <FromCode def={def} />
        <DefinitionHistory code={code} revision={def.version} />
      </div>
    </div>
  );
}

/** „Z kodu” (tylko do odczytu): kod, uprawnienie z rolami, formaty, orientacja, sekcje i parametry z katalogu w core. */
function FromCode({ def }: { def: ReportDefinitionDetails }) {
  const params: Array<{ name: string; values: string; rule: string }> = [
    {
      name: 'period',
      values: t('reports.definitions.params.period'),
      rule: t('reports.definitions.params.periodRule'),
    },
  ];
  if (def.params.granularity)
    params.push({
      name: 'granularity',
      values: t('reports.definitions.params.granularity'),
      rule: t('reports.definitions.params.granularityRule'),
    });
  if (def.params.compare)
    params.push({
      name: 'compare',
      values: t('reports.definitions.params.compare'),
      rule: t('reports.definitions.params.compareRule'),
    });
  for (const f of def.params.filters)
    params.push({
      name: f,
      values: t.dynamic(`reports.definitions.params.${f}`),
      rule: t('reports.definitions.params.optional'),
    });
  const sections = [
    def.sections.tiles.length > 0 ? t('reports.catalog.tiles') : null,
    ...def.sections.charts.map((c) => c.title.toLocaleLowerCase('pl')),
    ...def.sections.tables.map((tb) => tb.title.toLocaleLowerCase('pl')),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <section className="card rp-from-code" aria-labelledby="from-code">
      <div className="rp-card-head start">
        <h2 className="rp-card-title" id="from-code">
          {t('reports.definitions.fromCode')}
        </h2>
        <span className="rp-ro">
          <LockIcon size={12} />
          {t('reports.definitions.readOnly')}
        </span>
      </div>
      <dl className="rp-kv">
        <div>
          <dt>{t('reports.definitions.code')}</dt>
          <dd>
            <code className="rp-tagc">{def.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('reports.definitions.permission')}</dt>
          <dd>
            <code className="rp-tagc">{def.permissionCode}</code>
            {def.permissionRoles.length > 0 &&
              ` · ${t('reports.definitions.roles', { roles: def.permissionRoles.join(', ') })}`}
          </dd>
        </div>
        <div>
          <dt>{t('reports.definitions.formats')}</dt>
          <dd className="rp-pills">
            {def.formats.map((f) => (
              <span key={f} className="pill sm">
                {f}
              </span>
            ))}
            <span className="small">{t.dynamic(`reports.orientation.${def.orientation}`)}</span>
          </dd>
        </div>
        <div>
          <dt>{t('reports.definitions.sections')}</dt>
          <dd className="wrap">{sections}</dd>
        </div>
      </dl>
      <div className="rp-prm head">
        <span>{t('reports.definitions.paramName')}</span>
        <span>{t('reports.definitions.paramValues')}</span>
        <span>{t('reports.definitions.paramRule')}</span>
      </div>
      {params.map((p) => (
        <div key={p.name} className="rp-prm">
          <code>{p.name}</code>
          <span>{p.values}</span>
          <span className="small">{p.rule}</span>
        </div>
      ))}
      <p className="small">{t('reports.definitions.codeNote')}</p>
    </section>
  );
}

const ACTIONS = [
  'report_definition.created',
  'report_definition.synced',
  'report_definition.updated',
  'report_definitions.reordered',
];

/**
 * Historia zmian definicji: wpisy dziennika audytu `report_definition*` (API nie ma osobnego punktu historii definicji,
 * bo wpisy nie mają `entity_id`), zawężone do kodu definicji po treści wpisu. Wymaga `audit.read`.
 */
function DefinitionHistory({ code, revision }: { code: ReportCode; revision: number }) {
  const { can } = useSession();
  const allowed = can('audit.read');
  const [entries, setEntries] = useState<AuditLogDetails[] | null>(null);
  useEffect(() => {
    if (!allowed) return;
    let current = true;
    api<ListResponse<AuditLogListItem>>('/admin/audit-log?entityType=report_definition&pageSize=50')
      .then((r) =>
        Promise.all(
          r.items
            .filter((e) => ACTIONS.includes(e.action))
            .map((e) => api<AuditLogDetails>(`/admin/audit-log/${e.id}`).catch(() => null)),
        ),
      )
      .then((details) => {
        if (!current) return;
        setEntries(
          details.filter(
            (d): d is AuditLogDetails =>
              d !== null &&
              (d.data.code === code ||
                (typeof d.data.after === 'object' && d.data.after !== null && code in (d.data.after as object))),
          ),
        );
      })
      .catch(() => current && setEntries([]));
    return () => {
      current = false;
    };
  }, [allowed, code, revision]);

  return (
    <section className="card side-card history rp-def-history">
      <h2>{t('history.title')}</h2>
      {!allowed ? (
        <p>{t('reports.definitions.historyForbidden')}</p>
      ) : entries === null ? (
        <span className="skeleton" style={{ width: '60%' }} />
      ) : entries.length === 0 ? (
        <p>{t('history.empty')}</p>
      ) : (
        <ol>
          {entries.slice(0, 5).map((e, i) => (
            <li key={e.id}>
              <span className={i === 0 ? 'dot recent' : 'dot'} aria-hidden="true" />
              <div>
                <span>
                  <b>{e.staffName ?? t('audit.system')}</b> {historyText(e)}
                </span>
                <small>{formatDateTime(e.createdAt)}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {allowed && (
        <Link className="link" href="/admin/dziennik?entityType=report_definition">
          {t('reports.definitions.allAudit')}
        </Link>
      )}
    </section>
  );
}

function historyText(entry: AuditLogDetails): string {
  if (entry.action === 'report_definitions.reordered') return t('reports.definitions.history.reordered');
  if (entry.action === 'report_definition.updated') {
    const changes = Object.keys((entry.data.changes ?? {}) as object)
      .map((f) =>
        t.has(`reports.definitions.history.fields.${f}`) ? t.dynamic(`reports.definitions.history.fields.${f}`) : f,
      )
      .join(', ');
    return t('reports.definitions.history.updated', { fields: changes });
  }
  return t.has(`reports.definitions.history.${entry.action.split('.')[1]}`)
    ? t.dynamic(`reports.definitions.history.${entry.action.split('.')[1]}`)
    : entry.action;
}
