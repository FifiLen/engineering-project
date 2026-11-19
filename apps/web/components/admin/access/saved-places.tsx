'use client';

/**
 * Karta klienta → Zapisane miejsca (ADR 0076): `saved_places` w szczegółach klienta z filtrem etykiety, sortowaniem
 * i eksportem; operator z `users.manage` tylko usuwa miejsce (dodaje i zmienia je klient w aplikacji).
 */
import { savedPlacesResource, type SavedPlaceListItem } from '@hulajnogi/shared';
import { useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import type { FilterSpec } from '../filter-drawer';
import { TrashIcon } from '../icons';
import { InlineList } from '../inline-list';
import { valueLabel } from '../labels';
import { When } from '../list-format';
import type { Column } from '../resource-list';
import { Banner } from './common';

const filters: FilterSpec[] = [
  { field: 'label', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function SavedPlacesCard({ userId }: { userId: string }) {
  const { can } = useSession();
  const canManage = can('users.manage');
  const [removing, setRemoving] = useState<SavedPlaceListItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const columns: Column<SavedPlaceListItem>[] = [
    { field: 'label', width: '110px', render: (p) => <span className="pill">{valueLabel(savedPlacesResource, 'label', p.label)}</span> },
    { field: 'name', width: 'minmax(0,1fr)', render: (p) => p.name },
    {
      field: 'lat',
      width: '170px',
      render: (p) => (
        <span className="num small">{t('fleetLists.telemetry.coords', { lat: p.lat.toFixed(5), lon: p.lon.toFixed(5) })}</span>
      ),
    },
    { field: 'createdAt', width: '120px', render: (p) => <When at={p.createdAt} /> },
    {
      field: 'id',
      header: null,
      width: '40px',
      render: (p) =>
        canManage ? (
          <button
            type="button"
            className="icon-btn plain"
            aria-label={t('savedPlaces.remove', { name: p.name })}
            onClick={() => setRemoving(p)}
          >
            <TrashIcon size={16} />
          </button>
        ) : null,
    },
  ];

  return (
    <>
      {error && <Banner kind="danger">{error}</Banner>}
      <InlineList<SavedPlaceListItem>
        resource={savedPlacesResource}
        columns={columns}
        fixed={[{ field: 'userId', op: 'eq', values: [userId] }]}
        filters={filters}
        title={t('savedPlaces.title')}
        rowKey={(p) => p.id}
        emptyText={t('savedPlaces.empty')}
        revision={revision}
        pageSize={10}
        exportColumns={['label', 'name', 'lat', 'lon', 'createdAt']}
      />
      <ConfirmDialog
        open={removing !== null}
        danger
        title={t('savedPlaces.removeTitle', { name: removing?.name ?? '' })}
        body={t('savedPlaces.removeBody')}
        action={t('savedPlaces.removeSubmit')}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          setError(null);
          api(`/admin/saved-places/${target.id}`, { method: 'DELETE' })
            .then(() => setRevision((n) => n + 1))
            .catch((e: unknown) => setError(errorMessage(e)));
        }}
      />
    </>
  );
}
