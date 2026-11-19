/**
 * Paragon PDF (ADR 0068) i eksport danych (ADR 0069): zdarzenia z gniazda (`document.ready`, `data-export.ready`
 * w pokoju `user:{id}`; gniazdo jest w `rental.tsx`) i oczekiwanie na wydruk z odpytywaniem jako zapasem.
 */
import {
  DOCUMENT_POLL_INTERVAL_MS,
  DOCUMENT_WAIT_TIMEOUT_MS,
  type CustomerDocumentView,
  type DataExportReady,
  type DocumentReady,
} from '@hulajnogi/shared';
import { useEffect } from 'react';
import { api } from './api';

type DocumentListener = (event: DocumentReady | null) => void;
type ExportListener = (event: DataExportReady | null) => void;
const documentListeners = new Set<DocumentListener>();
const exportListeners = new Set<ExportListener>();

/** Wywołuje gniazdo po `document.ready` i po ponownym połączeniu (`null`: sprawdź stan od nowa). */
export function notifyDocumentReady(event: DocumentReady | null): void {
  for (const listener of documentListeners) listener(event);
}

/** Wywołuje gniazdo po `data-export.ready` i po ponownym połączeniu (`null`: pobierz stan od nowa). */
export function notifyDataExportReady(event: DataExportReady | null): void {
  for (const listener of exportListeners) listener(event);
}

/** Ekran „Pobierz moje dane” i wpis w ustawieniach odświeżają stan po zakończeniu zadania. */
export function useDataExportEvents(listener: ExportListener): void {
  useEffect(() => {
    exportListeners.add(listener);
    return () => {
      exportListeners.delete(listener);
    };
  }, [listener]);
}

/** Wydruk nie skończył się w [30] s; zadanie działa dalej, a ponowne dotknięcie wraca do tego samego wiersza. */
export class DocumentWaitTimeout extends Error {
  constructor() {
    super('DOCUMENT_WAIT_TIMEOUT');
  }
}

const finished = (doc: CustomerDocumentView) => doc.status === 'SUCCEEDED' || doc.status === 'FAILED';

/**
 * Czeka na stan końcowy wydruku klienta: `document.ready` z tym identyfikatorem budzi sprawdzenie od razu,
 * a w zapasie `GET /me/documents/{id}` co [2] s; po [30] s `DocumentWaitTimeout`. Pojedynczy błąd sieci przy
 * odpytywaniu nie przerywa oczekiwania (następna próba za 2 s). `isAlive` przerywa po wyjściu z ekranu.
 */
export function waitForDocument(id: string, isAlive: () => boolean): Promise<CustomerDocumentView> {
  return new Promise((resolve, reject) => {
    let done = false;
    let checking = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(deadline);
      documentListeners.delete(listener);
      fn();
    };
    const check = () => {
      if (!isAlive()) return finish(() => reject(new DocumentWaitTimeout()));
      if (checking) return;
      checking = true;
      api<CustomerDocumentView>(`/me/documents/${id}`)
        .then((doc) => {
          if (finished(doc)) finish(() => resolve(doc));
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    };
    const listener: DocumentListener = (event) => {
      if (!event || event.id === id) check();
    };
    documentListeners.add(listener);
    const timer = setInterval(check, DOCUMENT_POLL_INTERVAL_MS);
    const deadline = setTimeout(() => finish(() => reject(new DocumentWaitTimeout())), DOCUMENT_WAIT_TIMEOUT_MS);
  });
}
