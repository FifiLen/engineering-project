/**
 * Token push zalogowanego urządzenia (ADR 0058): rejestracja `POST /me/push-tokens` przy każdym starcie
 * (upsert po tokenie, przejęcie z innego konta) i usunięcie przy wylogowaniu, zanim sesja wygaśnie.
 */
import { api } from './api';
import { obtainPushToken } from './push';

let registered: string | null = null;

/** Rejestruje token, jeśli system pozwala na powiadomienia; bez tokenu nic się nie dzieje. */
export async function registerPushToken(): Promise<boolean> {
  const token = await obtainPushToken();
  if (!token) return false;
  try {
    await api('/me/push-tokens', { method: 'POST', json: token });
    registered = token.token;
    return true;
  } catch {
    return false;
  }
}

/** `DELETE /me/push-tokens/{token}` przed wylogowaniem (API usuwa też tokeny sesji przy wylogowaniu). */
export async function unregisterPushToken(): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  await api(`/me/push-tokens/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => undefined);
}
