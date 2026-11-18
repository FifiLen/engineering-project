/**
 * Formatowanie parametrów szablonów w API (ADR 0058): kwoty, numery i czasy trafiają do szablonu jako gotowy tekst
 * albo liczba do odmiany, więc treść nie zależy od danych ICU w Node. Zapis jak w panelu i aplikacji.
 */
import { formatPln, ticketLabel } from '@hulajnogi/shared';

/** Numer przejazdu „R-51858” (panel: `common.rentalNumber`, makieta `szablony-powiadomien`). */
export const rentalLabel = (number: number): string => `R-${number}`;

/** Numer hulajnogi „#0037”, zawsze w czterech cyfrach jak w aplikacji i w MQTT (ADR 0041). */
export const scooterLabel = (number: number): string => `#${String(number).padStart(4, '0')}`;

/** Numer zgłoszenia „Z-1042”. */
export { ticketLabel };

/** Kwota w groszach jako „19,60 zł”. */
export const amountLabel = (grosze: number): string => formatPln(grosze);

/** Czas przejazdu w pełnych minutach do odmiany w szablonie, najmniej 1. */
export const rideMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));
