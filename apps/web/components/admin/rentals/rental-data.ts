'use client';

import type { RentalAdminDetails } from '@hulajnogi/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { OPEN_STATES } from './rental-parts';

/** Kwota i trasa otwartego przejazdu zmieniają się bez zdarzenia (minuty, telemetria): odświeżenie co 20 s. */
const OPEN_REFRESH_MS = 20_000;

export interface RentalDetailsState {
  rental: RentalAdminDetails | null;
  /** Chwila odebrania szczegółów; od niej panel dolicza czas jazdy i pauzy. */
  receivedAt: number;
  error: string | null;
  refresh: () => void;
  apply: (rental: RentalAdminDetails) => void;
}

/** Szczegóły przejazdu z `GET /admin/rentals/{id}`; `revision` rośnie przy zdarzeniu `rentals.changed`. */
export function useRentalDetails(id: string, revision: number): RentalDetailsState {
  const [state, setState] = useState<{ rental: RentalAdminDetails | null; receivedAt: number; error: string | null }>({
    rental: null,
    receivedAt: 0,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const apply = useCallback(
    (rental: RentalAdminDetails) => setState({ rental, receivedAt: Date.now(), error: null }),
    [],
  );
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api<RentalAdminDetails>(`/admin/rentals/${id}`, { signal: controller.signal })
      .then(apply)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: errorMessage(e) }));
      });
    return () => controller.abort();
  }, [id, revision, tick, apply]);

  const open = state.rental !== null && OPEN_STATES.includes(state.rental.state);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(refresh, OPEN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  return { ...state, refresh, apply };
}
