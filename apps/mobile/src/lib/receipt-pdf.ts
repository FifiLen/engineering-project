/**
 * „Pobierz PDF” na paragonie (ADR 0068, plansze paragon-pdf, paragon-pdf-gotowy, paragon-pdf-blad):
 * - `POST /me/receipts/{id}/pdf` zwraca gotowy albo trwający wydruk tej wersji szablonu (`200`) albo nowy (`202`);
 * - w toku aplikacja czeka na `document.ready`, a w zapasie pyta `GET /me/documents/{id}` co [2] s; po [30] s
 *   pokazuje błąd, a zadanie działa dalej (wyjście z ekranu go nie anuluje, ponowne dotknięcie wraca do niego);
 * - aplikacja natywna pobiera plik do pamięci podręcznej i pokazuje arkusz „PDF gotowy”; kolejne dotknięcie
 *   w tej sesji otwiera arkusz od razu z pliku w pamięci;
 * - wersja web otwiera plik w nowej karcie (a gdy przeglądarka zablokuje okno, arkusz z „Otwórz”).
 * Kod błędu z API trafia do dziennika aplikacji, nie na ekran.
 */
import type { CustomerDocumentView, DocumentFileLink } from '@hulajnogi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { waitForDocument } from './documents';
import { downloadToCache, OPENS_IN_BROWSER, openInBrowser, stillCached, type SavedFile } from './download';

export type ReceiptPdfState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  /** Arkusz „PDF gotowy”: plik w telefonie albo (web) adres do otwarcia gestem. */
  | { kind: 'ready'; file: SavedFile | null; link: DocumentFileLink | null; name: string; sizeBytes: number }
  | { kind: 'error'; offline: boolean };

/** Pobrane pliki paragonów w tej sesji aplikacji (plik PDF paragonu nie zawiera danych spoza paragonu). */
const savedFiles = new Map<string, SavedFile>();

export function useReceiptPdf(receiptId: string) {
  const [state, setState] = useState<ReceiptPdfState>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const update = useCallback((next: ReceiptPdfState) => {
    if (alive.current) setState(next);
  }, []);

  const start = useCallback(async () => {
    const saved = savedFiles.get(receiptId);
    if (saved && stillCached(saved)) {
      setState({ kind: 'ready', file: saved, link: null, name: saved.name, sizeBytes: saved.sizeBytes });
      return;
    }
    setState({ kind: 'busy' });
    let requested = false;
    try {
      let doc = await api<CustomerDocumentView>(`/me/receipts/${receiptId}/pdf`, { method: 'POST' });
      requested = true;
      if (doc.status === 'QUEUED' || doc.status === 'RUNNING') doc = await waitForDocument(doc.id, () => alive.current);
      if (doc.status !== 'SUCCEEDED' || !doc.file) throw new ApiError(0, doc.errorCode ?? 'DOCUMENT_FAILED');
      const link = doc.file;
      if (OPENS_IN_BROWSER) {
        update(
          openInBrowser(link.url)
            ? { kind: 'idle' }
            : { kind: 'ready', file: null, link, name: link.fileName, sizeBytes: link.sizeBytes },
        );
        return;
      }
      const file = await downloadToCache(link.url, link.fileName);
      savedFiles.set(receiptId, file);
      update({ kind: 'ready', file, link: null, name: file.name, sizeBytes: link.sizeBytes });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : 'UNKNOWN';
      console.warn(`[paragon PDF] ${receiptId}: ${code}`);
      // „Sprawdź połączenie” tylko, gdy żądanie nie wyszło; brak sieci przy pobraniu pliku to zwykły błąd.
      update({ kind: 'error', offline: !requested && error instanceof ApiError && error.code === 'NETWORK' });
    }
  }, [receiptId, update]);

  const close = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, start, close };
}
