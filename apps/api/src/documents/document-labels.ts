/**
 * Teksty wartości wyliczeń na wydrukach (ADR 0067: „teksty wyliczeń dostarcza API”, katalog w core formatuje kwoty
 * i daty). Etykiety interfejsu klientów są w ich plikach tłumaczeń (ADR 0032), ale dokument powstaje w API, więc
 * kopia tekstów jest tutaj, zgodna z `apps/web/messages/pl.json` (`resource.*.values`). Teksty stałe szablonu
 * (nagłówki, podpis) zmienia Administrator w pliku DOCX, a nie w kodzie.
 */
type Labels = Readonly<Record<string, string>>;

export const RENTAL_STATE_LABELS: Labels = {
  RESERVED: 'Rezerwacja',
  UNLOCKING: 'Odblokowywanie',
  ACTIVE: 'W trakcie',
  PAUSED: 'Pauza',
  ENDING: 'Kończenie',
  ENDED: 'Zakończony',
  EXPIRED: 'Rezerwacja wygasła',
  UNLOCK_FAILED: 'Nie odblokowano',
  UNPAID: 'Nieopłacony',
};

export const END_MODE_LABELS: Labels = {
  CUSTOMER: 'Klient w aplikacji',
  CUSTOMER_OFFLINE: 'Klient, hulajnoga bez łączności',
  REMOTE: 'Zdalnie przez operatora',
  UNCONFIRMED: 'Bez potwierdzenia blokady',
};

export const PAYMENT_SOURCE_LABELS: Labels = { WALLET: 'Portfel', CARD: 'Karta' };

export const RECEIPT_ITEM_LABELS: Labels = {
  UNLOCK: 'Odblokowanie',
  RIDE_MINUTES: 'Minuty jazdy',
  PAUSE_MINUTES: 'Minuty pauzy',
  REFUND: 'Zwrot za przejazd',
  TOWING_FEE: 'Opłata za odholowanie',
};

export const SCOOTER_STATUS_LABELS: Labels = {
  AVAILABLE: 'Dostępna',
  RESERVED: 'Zarezerwowana',
  IN_USE: 'W użyciu',
  MAINTENANCE: 'Serwis',
  RETIRED: 'Wycofana',
};

export const SCOOTER_STATUS_REASON_LABELS: Labels = {
  URGENT_TICKET: 'pilne zgłoszenie',
  SERVICE_TASK: 'zadanie serwisowe',
  BATTERY_BELOW_THRESHOLD: 'bateria poniżej progu',
  OFFLINE: 'brak łączności',
  THEFT: 'kradzież',
  DAMAGE: 'zniszczenie',
  END_OF_LIFE: 'koniec eksploatacji',
  OTHER: 'inny powód',
};

export const SCOOTER_VARIANT_LABELS: Labels = { GRAFIT: 'Grafit', BETON: 'Beton', KOBALT: 'Kobalt' };

export const TASK_TYPE_LABELS: Labels = {
  REPAIR: 'Naprawa',
  BATTERY_SWAP: 'Wymiana baterii',
  INSPECTION: 'Przegląd',
  RELOCATION: 'Przewiezienie',
};

export const TASK_STATUS_LABELS: Labels = {
  OPEN: 'Otwarte',
  IN_PROGRESS: 'W toku',
  DONE: 'Zakończone',
  CANCELLED: 'Anulowane',
};

export const TASK_PRIORITY_LABELS: Labels = { LOW: 'Niski', NORMAL: 'Normalny', HIGH: 'Wysoki' };

export const TICKET_STATUS_LABELS: Labels = {
  NEW: 'Nowe',
  IN_PROGRESS: 'W trakcie',
  AT_SERVICE: 'W serwisie',
  RESOLVED: 'Rozwiązane',
};

export const TICKET_SOURCE_LABELS: Labels = { USER: 'Klient', AUTO: 'Automatyczne', STAFF: 'Operator' };

export const TICKET_CATEGORY_LABELS: Labels = {
  BRAKES: 'Hamulce',
  LIGHTS: 'Światła',
  WHEEL: 'Koło',
  HANDLEBAR: 'Kierownica',
  QR_CODE: 'Kod QR',
  BATTERY: 'Bateria',
  CONNECTION: 'Brak łączności',
  OTHER: 'Inne',
  BILLING: 'Rozliczenie',
  OUT_OF_ZONE: 'Poza strefą',
};

export const LEDGER_REASON_LABELS: Labels = {
  COMPLAINT: 'Reklamacja',
  SYSTEM_ERROR: 'Błąd systemu',
  GOODWILL: 'Gest dobrej woli',
  OTHER: 'Inny powód',
};

export const REFUND_REASON_LABELS: Labels = {
  SCOOTER_FAILURE: 'Awaria hulajnogi',
  BILLING_ERROR: 'Błąd naliczenia',
  CUSTOMER_COMPLAINT: 'Reklamacja klienta',
  OTHER: 'Inny powód',
  BALANCE_PAYOUT: 'Zwrot salda',
};

/** Zdarzenia osi czasu przejazdu (`rental_events.type`) poza zmianą stanu. */
export const RENTAL_EVENT_LABELS: Labels = {
  ZONE_ENTERED: 'Wjazd do strefy',
  ZONE_EXITED: 'Wyjazd ze strefy',
  BATTERY_LOW: 'Niska bateria',
  CONNECTION_LOST: 'Utrata łączności',
  CONNECTION_RESTORED: 'Łączność przywrócona',
  PHOTO_UPLOADED: 'Zdjęcie parkowania',
  END_REQUESTED: 'Żądanie zakończenia',
  PAUSE_FAILED: 'Pauza niepotwierdzona',
  RESUME_FAILED: 'Wznowienie niepotwierdzone',
  LOCK_FAILED: 'Blokada niepotwierdzona',
  ENDED_REMOTELY: 'Zakończono zdalnie',
  LATE_UNLOCK_LOCKED: 'Spóźnione odblokowanie',
  BILLING_STOPPED: 'Naliczanie zatrzymane',
  MOVED_AFTER_END: 'Ruch po zakończeniu',
};

/** Zmiana stanu przejazdu (`STATE_CHANGED`) według stanu docelowego i wyjściowego, jak oś czasu w panelu. */
export function rentalTransitionLabel(from: string | null, to: string): string {
  if (to === 'ACTIVE') {
    if (from === 'UNLOCKING') return 'Odblokowano hulajnogę';
    if (from === 'PAUSED') return 'Wznowiono jazdę';
    if (from === 'ENDING') return 'Blokada niepotwierdzona';
  }
  if (to === 'PAUSED' && from === 'ENDING') return 'Blokada niepotwierdzona';
  if (to === 'ENDED' && from === 'UNPAID') return 'Spłacono zaległość';
  const labels: Labels = {
    RESERVED: 'Rezerwacja',
    UNLOCKING: 'Żądanie odblokowania',
    ACTIVE: 'Rozpoczęto jazdę',
    PAUSED: 'Pauza',
    ENDING: 'Żądanie zakończenia',
    ENDED: 'Zakończono przejazd',
    EXPIRED: 'Rezerwacja wygasła',
    UNLOCK_FAILED: 'Nie odblokowano',
    UNPAID: 'Płatność odrzucona',
  };
  return label(labels, to);
}

/** Wpisy dziennika zadania serwisowego i zgłoszenia (oś czasu protokołu i raportu). */
export const AUDIT_ACTION_LABELS: Labels = {
  'service_task.created': 'Utworzono zadanie',
  'service_task.assigned': 'Przypisano wykonawcę',
  'service_task.started': 'Rozpoczęto',
  'service_task.part_added': 'Dodano część',
  'service_task.part_removed': 'Usunięto część',
  'service_task.completed': 'Zakończono',
  'service_task.cancelled': 'Anulowano',
  'ticket.created': 'Zgłoszono',
  'ticket.assigned': 'Przypisano operatora',
  'ticket.status_changed': 'Zmiana stanu',
  'ticket.auto_closed': 'Zamknięto automatycznie',
  'ticket.photo_added': 'Dodano zdjęcie',
  'ticket.photo_removed': 'Usunięto zdjęcie',
};

/** Tekst wartości albo sama wartość, gdy nie ma tekstu (nowa wartość wyliczenia nie psuje wydruku). */
export const label = (labels: Labels, value: unknown): string =>
  value === null || value === undefined ? '' : (labels[String(value)] ?? String(value));
