import { Suspense } from 'react';
import { CommandList } from '../../../../../components/admin/fleet/commands';

/** Flota → Komendy (ADR 0076): komendy MQTT hulajnóg, tylko do odczytu. */
export default function FleetCommandsPage() {
  return (
    <main className="page-main">
      <Suspense>
        <CommandList />
      </Suspense>
    </main>
  );
}
