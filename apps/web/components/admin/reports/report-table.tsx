'use client';

/**
 * Tabela podglądu raportu (ADR 0071): kolumny i etykiety z katalogu w core (przychodzą z API), liczby wyrównane do
 * prawej, wiersze sum pośrednich wyróżnione, wiersz „Razem” z `totals`, udział z paskiem i sortowanie w nagłówku
 * (w obrębie wierszy podglądu). Zwykła tabela HTML: szerokości kolumn z treści, szeroka tabela przewija się w poziomie.
 * Podgląd ma najwyżej 200 wierszy; dopisek podaje liczbę wszystkich (pełne dane w XLSX).
 */
import type { ReportTable, ReportValueKind } from '@hulajnogi/shared';
import { useMemo, useState } from 'react';
import { t } from '../../../lib/i18n';
import { ArrowDown, ArrowUp } from '../icons';
import { formatNumber, formatReportValue } from './reports-common';

const NUMERIC: ReadonlySet<ReportValueKind> = new Set(['money', 'number', 'duration', 'distance', 'percent']);

/** Szeroka tabela (wiele kolumn) zajmuje całą szerokość; węższe stają parami. */
export const tableIsWide = (table: ReportTable) => table.columns.length > 6;

type Sort = { key: string; desc: boolean } | null;

export function ReportTableCard({ table }: { table: ReportTable }) {
  const [sort, setSort] = useState<Sort>(null);
  // Wiersze sum pośrednich mają sens tylko w kolejności z API.
  const sortable = !table.rows.some((r) => r.style === 'subtotal');
  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const value = (r: (typeof table.rows)[number]) => r.cells[sort.key] ?? null;
    return [...table.rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pl');
      return sort.desc ? -cmp : cmp;
    });
  }, [table, sort]);

  // Liczby najpierw malejąco, tekst rosnąco; trzecie kliknięcie wraca do kolejności z API.
  const toggle = (key: string, kind: ReportValueKind) => {
    setSort((s) =>
      s?.key !== key ? { key, desc: NUMERIC.has(kind) } : s.desc === NUMERIC.has(kind) ? { key, desc: !s.desc } : null,
    );
  };
  const firstKey = table.columns[0]?.key;
  const numericHead = (kind: ReportValueKind, key: string) => NUMERIC.has(kind) && key !== 'share';

  return (
    <section className="card rp-card rp-table-card" aria-labelledby={`rt-${table.key}`}>
      <div className="rp-card-head">
        <h2 className="rp-card-title" id={`rt-${table.key}`}>
          {table.title}
        </h2>
        {table.description && (
          <span className="small rp-card-desc" title={table.description}>
            {table.description}
          </span>
        )}
      </div>
      <div className="rp-table-scroll">
        <table className="rp-table" aria-labelledby={`rt-${table.key}`}>
          <thead>
            <tr>
              {table.columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={numericHead(c.kind, c.key) ? 'n' : undefined}
                    aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : sortable ? 'none' : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={active ? 'th-sort active' : 'th-sort'}
                        onClick={() => toggle(c.key, c.kind)}
                        aria-label={t('list.sortBy', { field: c.label })}
                      >
                        {c.label}
                        {active && (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={row.style === 'subtotal' ? 'subtotal' : undefined}>
                {table.columns.map((c) => (
                  <Cell
                    key={c.key}
                    kind={c.kind}
                    decimals={c.decimals}
                    value={row.cells[c.key] ?? null}
                    share={c.key === 'share'}
                  />
                ))}
              </tr>
            ))}
          </tbody>
          {table.totals && (
            <tfoot>
              <tr>
                {table.columns.map((c) => {
                  const value = table.totals?.[c.key] ?? null;
                  if (c.key === firstKey && (value === null || value === ''))
                    return <td key={c.key}>{t('reports.table.total')}</td>;
                  return (
                    <Cell key={c.key} kind={c.kind} decimals={c.decimals} value={value} share={c.key === 'share'} />
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.totalRows > table.rows.length && (
        <p className="small rp-truncated">
          {t('reports.table.truncated', {
            shown: formatNumber(table.rows.length),
            total: formatNumber(table.totalRows),
          })}
        </p>
      )}
      {table.totalRows === 0 && <p className="small rp-truncated">{t('reports.table.empty')}</p>}
    </section>
  );
}

function Cell({
  kind,
  decimals,
  value,
  share,
}: {
  kind: ReportValueKind;
  decimals?: number;
  value: number | string | null;
  share?: boolean;
}) {
  const text = formatReportValue(kind, value, decimals, true);
  if (share && typeof value === 'number') {
    return (
      <td>
        <span className="rp-share">
          <span className="rp-share-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
          </span>
          <span className="num">{text}</span>
        </span>
      </td>
    );
  }
  return <td className={NUMERIC.has(kind) ? 'n num' : undefined}>{text}</td>;
}
