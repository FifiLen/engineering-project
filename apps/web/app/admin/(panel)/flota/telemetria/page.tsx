import { Suspense } from 'react';
import { TelemetryPage } from '../../../../../components/admin/fleet/telemetry';

/** Flota → Telemetria (ADR 0076): odczyty jednej hulajnogi w zakresie do 24 h, kursorem bez liczby wszystkich. */
export default function FleetTelemetryPage() {
  return (
    <main className="page-main">
      <Suspense>
        <TelemetryPage />
      </Suspense>
    </main>
  );
}
