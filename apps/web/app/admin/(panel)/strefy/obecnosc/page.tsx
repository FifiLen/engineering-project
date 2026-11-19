import { Suspense } from 'react';
import { ZonePresenceList } from '../../../../../components/admin/zones/zone-lists';

/** Strefy → Obecność w strefach (ADR 0076): hulajnogi w strefach w trwających przejazdach. */
export default function ZonePresencePage() {
  return (
    <main className="page-main">
      <Suspense>
        <ZonePresenceList />
      </Suspense>
    </main>
  );
}
