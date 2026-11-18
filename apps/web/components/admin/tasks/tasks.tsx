'use client';

/**
 * Zadania serwisowe w panelu (makieta zadania-lista, ADR 0055): „Moje zadania” jako karty zadań otwartych i w toku
 * przypisanych do zalogowanego (najpierw w toku, potem priorytet i termin) oraz lista wszystkich zadań według wzorca.
 * „Rozpocznij” przypisuje nieprzypisane zadanie do siebie. Zmiany przychodzą z pokoju `service`.
 */
import {
  formatPln,
  serviceTasksResource,
  type ListResponse,
  type ServiceTaskDetails,
  type ServiceTaskListItem,
  type TaskPriority,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatClock, formatDate, isToday, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { scooterNumber } from '../fleet/fleet-format';
import { BriefcaseIcon } from '../icons';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import {
  categoryLabel,
  PriorityPill,
  TASKS_BASE,
  TaskStatusPill,
  taskNumber,
  taskTypeLabel,
  ticketNumber,
} from '../service/service-format';
import { TaskCreateDialog } from '../service/task-create-dialog';
import { Assignee } from '../tickets/ticket-parts';

/** Zadania do zrobienia (domyślny szybki filtr i „Moje zadania”). */
export const TODO_STATES = ['OPEN', 'IN_PROGRESS'] as const;

/** Termin jak w makiecie: „dziś, 16:00” albo „20 lis, 12:00”. */
export function dueLabel(iso: string | null): string {
  if (!iso) return t('tasks.noDue');
  return isToday(iso)
    ? t('tasks.dueToday', { time: formatClock(iso) })
    : t('tasks.dueDate', { date: formatDate(iso), time: formatClock(iso) });
}

/** Zgłoszenie w wierszu: „Z-2318 · Bateria” albo „bez zgłoszenia”. */
function ticketCell(x: Pick<ServiceTaskListItem, 'ticketNumber' | 'ticketCategories'>) {
  if (x.ticketNumber === null) return <span className="muted">{t('service.noTicket')}</span>;
  const category = x.ticketCategories?.[0];
  return (
    <span>
      <span className="strong">{ticketNumber(x.ticketNumber)}</span>
      {category && ` · ${categoryLabel(category)}`}
    </span>
  );
}

const columns: Column<ServiceTaskListItem>[] = [
  { field: 'number', width: '70px', render: (x) => taskNumber(x.number) },
  {
    field: 'scooterNumber',
    width: '64px',
    render: (x) => <span className="strong">{scooterNumber(x.scooterNumber)}</span>,
  },
  { field: 'type', width: '136px', render: (x) => taskTypeLabel(x.type) },
  { field: 'status', width: '92px', render: (x) => <TaskStatusPill status={x.status} /> },
  { field: 'priority', width: '92px', render: (x) => <PriorityPill priority={x.priority} /> },
  { field: 'assigneeName', width: 'minmax(0,1fr)', render: (x) => <Assignee name={x.assigneeName} /> },
  {
    field: 'dueAt',
    width: '120px',
    render: (x) => <span className={x.overdue ? 'num overdue' : x.dueAt ? 'num' : 'muted'}>{dueLabel(x.dueAt)}</span>,
  },
  { field: 'ticketNumber', width: '170px', render: ticketCell },
  {
    field: 'partsCost',
    width: '84px',
    render: (x) => (
      <span className={x.partsCost > 0 ? 'num right-cell' : 'muted right-cell'}>
        {x.partsCost > 0 ? formatPln(x.partsCost) : t('common.none')}
      </span>
    ),
  },
];

const filters: FilterSpec[] = [
  { field: 'type', kind: 'checklist' },
  { field: 'priority', kind: 'checklist' },
  { field: 'overdue', kind: 'boolean' },
  { field: 'dueAt', kind: 'dateRange' },
  { field: 'completedAt', kind: 'dateRange' },
];

const sum = (counts: Record<string, number> | undefined, keys: readonly string[]) =>
  keys.reduce((total, key) => total + (counts?.[key] ?? 0), 0);

const presets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } = {
  facets: ['status'],
  total: (f) => Object.values(f.status ?? {}).reduce((a, b) => a + b, 0),
  items: [
    { key: 'todo', states: TODO_STATES },
    { key: 'OPEN', states: ['OPEN'] },
    { key: 'IN_PROGRESS', states: ['IN_PROGRESS'] },
    { key: 'DONE', states: ['DONE'] },
    { key: 'CANCELLED', states: ['CANCELLED'] },
  ].map(({ key, states }) => ({
    key,
    label: key === 'todo' ? t('resource.service-tasks.quick.todo') : t.dynamic(`service.taskStatus.${key}`),
    filters: [{ field: 'status', op: 'eq', values: [...states] }],
    count: (f) => sum(f.status, states),
  })),
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

/** Kolejność „Moich zadań”: najpierw w toku, potem priorytet i termin. */
function byUrgency(a: ServiceTaskListItem, b: ServiceTaskListItem): number {
  const started = Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS');
  if (started) return started;
  const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priority) return priority;
  return (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
}

/** Podtytuł: do zrobienia i po terminie (bez filtrów listy). */
function useTodoSummary(revision: number): { todo: number; overdue: number } | null {
  const [summary, setSummary] = useState<{ todo: number; overdue: number } | null>(null);
  useEffect(() => {
    api<ListResponse<ServiceTaskListItem>>(
      `/admin/service-tasks?status=${TODO_STATES.join(',')}&pageSize=1&facets=overdue`,
    )
      .then((r) => setSummary({ todo: r.total, overdue: r.facets.overdue?.true ?? 0 }))
      .catch(() => setSummary(null));
  }, [revision]);
  return summary;
}

function useDefaultTodo() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (searchParams.size === 0) router.replace(`${pathname}?status=${TODO_STATES.join(',')}`, { scroll: false });
  }, [router, pathname, searchParams]);
}

/** Lista zadań; `creating` otwiera okno „Nowe zadanie” (adres `/admin/zadania/nowy`). */
export function TaskList({ creating = false }: { creating?: boolean }) {
  useDefaultTodo();
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const listeners = useRef(new Set<(item: ServiceTaskListItem | null) => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summary = useTodoSummary(revision);

  const changed = () => {
    for (const listener of listeners.current) listener(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevision((n) => n + 1), 1500);
  };
  useStaffFeed({ service: changed, reconnected: changed });
  const subscribe = useCallback((listener: (item: ServiceTaskListItem | null) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <>
      <ResourceList<ServiceTaskListItem>
        resource={serviceTasksResource}
        basePath={TASKS_BASE}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(x) => taskNumber(x.number)}
        summary={(data) =>
          summary
            ? t('resource.service-tasks.summaryTodo', summary)
            : t('resource.service-tasks.summary', { count: data.total })
        }
        emptyIcon={<BriefcaseIcon size={22} />}
        selectable={false}
        subscribe={subscribe}
        tabs={
          <>
            <MyTasks revision={revision} />
            <h2 className="section-title">{t('tasks.all')}</h2>
          </>
        }
      />
      {creating && (
        <TaskCreateDialog
          mode="create"
          scooter={null}
          onClose={() => router.replace(TASKS_BASE)}
          onCreated={(task) => router.push(`${TASKS_BASE}/${task.id}`)}
        />
      )}
    </>
  );
}

/** „Moje zadania” (makieta): karty zadań otwartych i w toku przypisanych do zalogowanego operatora. */
function MyTasks({ revision }: { revision: number }) {
  const router = useRouter();
  const { can } = useSession();
  const [items, setItems] = useState<ServiceTaskListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<ListResponse<ServiceTaskListItem>>(`/admin/service-tasks/mine?status=${TODO_STATES.join(',')}&pageSize=50`)
      .then((r) => setItems([...r.items].sort(byUrgency)))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [revision]);

  const start = async (task: ServiceTaskListItem) => {
    setBusy(task.id);
    setError(null);
    try {
      await api<ServiceTaskDetails>(`/admin/service-tasks/${task.id}/start`, {
        method: 'POST',
        json: { version: task.version },
      });
      router.push(`${TASKS_BASE}/${task.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  if (!items) return error ? <Banner kind="danger">{error}</Banner> : null;
  return (
    <section className="my-tasks" aria-labelledby="my-tasks-title">
      <div className="my-tasks-head">
        <h2 id="my-tasks-title" className="section-title">
          {t('tasks.mine.title')}
        </h2>
        <span className="small">
          {items.length ? t('tasks.mine.summary', { count: items.length }) : t('tasks.mine.empty')}
        </span>
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      {items.length > 0 && (
        <div className="my-tasks-grid">
          {items.slice(0, 3).map((task) => (
            <article key={task.id} className={task.status === 'IN_PROGRESS' ? 'mycard on' : 'mycard'}>
              <div className="mycard-pills">
                <span className="strong">{taskNumber(task.number)}</span>
                <TaskStatusPill status={task.status} />
                <PriorityPill priority={task.priority} />
              </div>
              <div className="mycard-body">
                <span className="thumb" aria-hidden="true">
                  {/* Render hulajnogi z makiet; ta sama grafika dla wszystkich wariantów. */}
                  <img src="/rendery/hulajnoga-grafit-bok.png" alt="" />
                </span>
                <span className="stack">
                  <span className="mycard-title">
                    {t('tasks.mine.cardTitle', {
                      type: taskTypeLabel(task.type),
                      scooter: scooterNumber(task.scooterNumber),
                    })}
                  </span>
                  <span className="small">{myTaskDetail(task)}</span>
                </span>
              </div>
              <div className="mycard-foot">
                <span className="small">
                  {t('tasks.mine.due')}{' '}
                  <span className={task.overdue ? 'num overdue' : 'num strong-500'}>{dueLabel(task.dueAt)}</span>
                </span>
                {task.status === 'OPEN' && can('service.manage') ? (
                  <button type="button" className="btn" disabled={busy === task.id} onClick={() => void start(task)}>
                    {t('tasks.start')}
                  </button>
                ) : (
                  <Link className="btn" href={`${TASKS_BASE}/${task.id}`}>
                    {t('tasks.open')}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Druga linia karty: kategoria i zgłoszenie, cel przewiezienia albo opis, do tego części. */
function myTaskDetail(task: ServiceTaskListItem): string {
  const target =
    task.type === 'RELOCATION' && task.targetZoneCode
      ? t('tasks.mine.target', { code: task.targetZoneCode, name: task.targetZoneName ?? '' })
      : null;
  return [
    target,
    task.ticketCategories?.[0] && categoryLabel(task.ticketCategories[0]),
    task.ticketNumber !== null ? ticketNumber(task.ticketNumber) : t('service.noTicket'),
    task.partsCount > 0 && t('tasks.mine.parts', { count: task.partsCount, cost: formatPln(task.partsCost) }),
  ]
    .filter(Boolean)
    .join(' · ');
}
