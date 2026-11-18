/**
 * Zgłoszenia klienta (ADR 0055, makiety 26-mobile-operacje): zmiany na żywo przez Socket.IO
 * (`ticket.updated` w pokoju klienta; gniazdo jest w `rental.tsx`) i etykiety kategorii oraz statusów.
 */
import type { TicketCategory, TicketStatus, TicketUpdated } from '@hulajnogi/shared';
import { useEffect } from 'react';
import type { IconName } from '../components/icons';
import { t } from '../i18n';

type Listener = (ticket: TicketUpdated | null) => void;
const listeners = new Set<Listener>();

/** Wywołuje gniazdo po `ticket.updated` i po ponownym połączeniu (`null`: pobierz od nowa). */
export function notifyTicketUpdated(ticket: TicketUpdated | null): void {
  for (const listener of listeners) listener(ticket);
}

/** Lista i szczegóły zgłoszenia odświeżają się po zmianie statusu albo odpowiedzi. */
export function useTicketEvents(listener: Listener): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

/** „Hamulce”, „Kod QR”, „Rozliczenie”. */
export const categoryName = (category: TicketCategory): string => t.dynamic(`tickets.categories.${category}`);

/** „Światła, Koło” (kategorie w kolejności zapisu). */
export const categoryList = (categories: readonly TicketCategory[]): string => categories.map(categoryName).join(', ');

/** Status dla klienta: Przyjęte, W toku, W serwisie, Rozwiązane. */
export const statusName = (status: TicketStatus): string => t.dynamic(`tickets.statuses.${status}`);

/** Ikona rodzaju (makieta moje-zgloszenia): reklamacja paragon, kod QR kod, pozostałe klucz serwisowy. */
export function ticketIcon(categories: readonly TicketCategory[]): IconName {
  if (categories.length && categories.every((c) => c === 'BILLING')) return 'receipt';
  if (categories.length && categories.every((c) => c === 'QR_CODE')) return 'qr';
  return 'wrench';
}
