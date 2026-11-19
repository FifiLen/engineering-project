'use client';

/**
 * Zlecenia „Pobierz moje dane” na karcie klienta (ADR 0069): zasób `data-exports` tylko do odczytu z `users.read`,
 * ze stanem, datami i rozmiarem, bez pobierania pliku (plik dostaje tylko klient w aplikacji).
 */
import { dataExportsResource, type DataExportListItem, type ListResponse } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { valueLabel } from '../labels';
import { formatSize } from './prints-common';

const STATE_PILL: Record<DataExportListItem['state'], string> = {
  QUEUED: 'pill sm',
  RUNNING: 'pill accent sm',
  SUCCEEDED: 'pill accent sm',
  FAILED: 'pill danger sm',
  EXPIRED: 'pill muted sm',
  DELETED: 'pill muted sm',
};

export function CustomerDataExports({ userId }: { userId: string }) {
  const { can } = useSession();
  const allowed = can('users.read');
  const [data, setData] = useState<ListResponse<DataExportListItem> | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api<ListResponse<DataExportListItem>>(`/admin/data-exports?userId=${userId}&pageSize=10`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, [allowed, userId]);
  if (!allowed || !data) return null;
  return (
    <section className="card side-card">
      <div className="section-head">
        <h2>{t('resource.data-exports.title')}</h2>
        <span className="small">{t('resource.data-exports.hint')}</span>
      </div>
      <ul className="list-plain pr-exports">
        {data.items.length === 0 && <li className="muted">{t('resource.data-exports.emptyTitle')}</li>}
        {data.items.map((item) => (
          <li key={item.id}>
            <span className="grow">
              {formatDateTime(item.requestedAt)}
              <small>
                {[
                  item.sizeBytes !== null && formatSize(item.sizeBytes),
                  item.expiresAt &&
                    item.state === 'SUCCEEDED' &&
                    t('resource.data-exports.expires', { date: formatDateTime(item.expiresAt) }),
                  item.errorCode,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <span className={STATE_PILL[item.state]}>{valueLabel(dataExportsResource, 'state', item.state)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
