/**
 * Pobranie pliku z adresu z podpisem (ADR 0057) i przekazanie go dalej (ADR 0068, 0069):
 * - aplikacja natywna pobiera plik do `Paths.cache` (`File.downloadFileAsync`), udostępnia go systemowym arkuszem
 *   (`expo-sharing`) albo otwiera podgląd systemowy (`File.preview`);
 * - wersja web otwiera adres w nowej karcie, bo `expo-sharing` w przeglądarce nie udostępnia plików lokalnych.
 * Adresy z widoków API są względne (`/files/{id}?exp&sig`), więc doklejamy adres API (`fileUrl`).
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { fileUrl } from './files';

export type FileKind = 'pdf' | 'json';

const TYPES: Record<FileKind, { mimeType: string; UTI: string }> = {
  pdf: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
  json: { mimeType: 'application/json', UTI: 'public.json' },
};

/** Plik w pamięci podręcznej telefonu. */
export interface SavedFile {
  uri: string;
  name: string;
  sizeBytes: number;
}

/** Wersja web: bez pobierania do pamięci telefonu, plik otwiera przeglądarka. */
export const OPENS_IN_BROWSER = Platform.OS === 'web';

/** Pobranie do `Paths.cache` pod nazwą z API (`PAR-2026-000123.pdf`); istniejący plik jest zastępowany. */
export async function downloadToCache(url: string, name: string): Promise<SavedFile> {
  const file = await File.downloadFileAsync(fileUrl(url), new File(Paths.cache, name), { idempotent: true });
  return { uri: file.uri, name, sizeBytes: file.size };
}

/** Plik z pamięci podręcznej, jeśli nadal tam jest (system może ją wyczyścić). */
export function stillCached(file: SavedFile): boolean {
  try {
    return new File(file.uri).exists;
  } catch {
    return false;
  }
}

/** Systemowy arkusz udostępniania (zapis w Plikach, poczta, komunikatory). */
export async function shareFile(file: SavedFile, kind: FileKind, dialogTitle: string): Promise<void> {
  await Sharing.shareAsync(file.uri, { ...TYPES[kind], dialogTitle });
}

/** Podgląd systemowy (iOS Quick Look, Android aplikacja do PDF). */
export async function previewFile(file: SavedFile, kind: FileKind): Promise<void> {
  await File.preview(new File(file.uri), { mimeType: TYPES[kind].mimeType, title: file.name });
}

/** Usunięcie kopii z pamięci podręcznej (plik z danymi osobowymi po udostępnieniu, ADR 0069). */
export function removeCached(file: SavedFile): void {
  try {
    const local = new File(file.uri);
    if (local.exists) local.delete();
  } catch {
    // Brak pliku albo brak dostępu: system i tak czyści pamięć podręczną.
  }
}

/**
 * Wersja web: adres w nowej karcie. Przeglądarka może zablokować okno otwarte po dłuższym oczekiwaniu (bez
 * gestu użytkownika); wtedy `false`, a ekran pokazuje przycisk „Otwórz”, którego dotknięcie otwiera kartę.
 * `attachment`: plik z `Content-Disposition: attachment` (eksport danych) przy zablokowanym oknie pobiera się
 * w tej samej karcie, bo przeglądarka nie opuszcza wtedy strony.
 */
export function openInBrowser(url: string, { attachment = false }: { attachment?: boolean } = {}): boolean {
  if (typeof window === 'undefined') return false;
  const opened = window.open(fileUrl(url), '_blank');
  if (opened) {
    opened.opener = null;
    return true;
  }
  if (!attachment) return false;
  window.location.assign(fileUrl(url));
  return true;
}
