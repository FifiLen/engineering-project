/** Wiadomość push na jedno urządzenie (token Expo); `data.path` otwiera ekran aplikacji (ADR 0058). */
export interface PushMessage {
  to: string;
  title: string | null;
  body: string;
  data: { path: string | null; notificationId: number; templateCode: string };
}

/** Kody błędów Expo Push istotne dla nas; pozostałe trafiają do `notifications.error` jako tekst. */
export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/**
 * Wynik dla jednej wiadomości (ten sam indeks co w żądaniu): bilet do sprawdzenia potwierdzenia albo błąd.
 * `DeviceNotRegistered` znaczy, że na ten token nie wolno już wysyłać.
 */
export type PushTicket =
  { to: string; ok: true; ticketId: string } | { to: string; ok: false; error: string; deviceNotRegistered: boolean };

/** Potwierdzenie dostarczenia (receipt) po około 15 min; brak wpisu znaczy, że usługa go jeszcze nie ma. */
export type PushReceipt = { ok: true } | { ok: false; error: string; deviceNotRegistered: boolean };

/**
 * Port bramki push (ADR 0058), jak bramka SMS i operator płatności: Expo Push (`expo-server-sdk`) albo atrapa
 * w procesie. Niedostępność usługi po ponowieniach wraca jako błąd w biletach, a nie wyjątek.
 */
export interface PushGateway {
  readonly name: 'expo' | 'fake';
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>>;
}

export const PUSH_GATEWAY = Symbol('PUSH_GATEWAY');
