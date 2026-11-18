'use client';

import type { AuditLogDetails } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDateTime, t } from '../../lib/i18n';

/** Etykieta akcji z dziennika audytu; nieznana akcja pokazuje swój kod. */
export function actionLabel(action: string): string {
  const key = `audit.actions.${action}`;
  return t.has(key) ? t.dynamic(key) : action;
}

/** Zmienione pola wpisu jako krótki tekst (nazwy pól z tłumaczeń zasobu, jeśli są). */
export function changedFields(entry: Pick<AuditLogDetails, 'data'>, resourceName?: string): string {
  const changes = entry.data?.changes;
  if (!changes || typeof changes !== 'object') return '';
  return Object.keys(changes)
    .map((field) => {
      const key = `resource.${resourceName}.fields.${field}`;
      return resourceName && t.has(key) ? t.dynamic(key).toLowerCase() : field;
    })
    .join(', ');
}

/**
 * Karta „Historia zmian” w formularzu (makieta wzorzec-formularz): ostatnie wpisy dziennika audytu rekordu.
 * `revision` (np. wersja rekordu) wymusza ponowne wczytanie po zapisie.
 */
export function HistoryCard({
  path,
  resourceName,
  revision,
}: {
  path: string;
  resourceName?: string;
  revision?: number | string;
}) {
  const [entries, setEntries] = useState<AuditLogDetails[] | null>(null);
  useEffect(() => {
    api<AuditLogDetails[]>(path)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [path, revision]);

  return (
    <section className="card side-card history">
      <h2>{t('history.title')}</h2>
      {entries === null ? (
        <span className="skeleton" style={{ width: '60%' }} />
      ) : entries.length === 0 ? (
        <p>{t('history.empty')}</p>
      ) : (
        <ol>
          {entries.slice(0, 6).map((e, i) => {
            const fields = changedFields(e, resourceName);
            return (
              <li key={e.id}>
                <span className={i === 0 ? 'dot recent' : 'dot'} aria-hidden="true" />
                <div>
                  <span>
                    <b>{e.staffName ?? t('audit.system')}</b> {actionLabel(e.action).toLowerCase()}
                    {fields && <span className="muted">{t('history.fields', { fields })}</span>}
                  </span>
                  <small>{formatDateTime(e.createdAt)}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
