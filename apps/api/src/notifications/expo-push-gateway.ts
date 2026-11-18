import { Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import {
  DEVICE_NOT_REGISTERED,
  type PushGateway,
  type PushMessage,
  type PushReceipt,
  type PushTicket,
} from './push-gateway.js';

/** Część klienta `expo-server-sdk`, której używa bramka; testy podstawiają atrapę bez sieci. */
export type ExpoClient = Pick<
  Expo,
  'sendPushNotificationsAsync' | 'chunkPushNotificationReceiptIds' | 'getPushNotificationReceiptsAsync'
>;

export interface ExpoRetryPolicy {
  /** Liczba prób jednego żądania (pierwsza i ponowienia). */
  attempts: number;
  /** Odstęp przed pierwszym ponowieniem; każdy następny jest dwa razy dłuższy. */
  baseDelayMs: number;
}

const DEFAULT_RETRY: ExpoRetryPolicy = { attempts: 4, baseDelayMs: 1000 };

/** Limit wiadomości w jednym żądaniu Expo Push (sprawdzone w dokumentacji Expo, ADR 0058). */
export const EXPO_MAX_BATCH = 100;

/** Błąd do ponowienia: limit (429), błąd serwera (5xx) albo sieć (brak kodu odpowiedzi). */
export function isRetryable(error: unknown): boolean {
  const status = (error as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

/**
 * Expo Push API (ADR 0058) przez `expo-server-sdk`: partie do 100 wiadomości, opcjonalny `EXPO_ACCESS_TOKEN`
 * i ponowienia z wykładniczym odstępem przy 429, 5xx i błędzie sieci. Partia, której nie udało się wysłać,
 * wraca jako błędy w biletach (powiadomienie dostaje `FAILED`), a nie wyjątek.
 */
export class ExpoPushGateway implements PushGateway {
  readonly name = 'expo' as const;
  private readonly logger = new Logger('ExpoPush');
  private readonly client: ExpoClient;

  constructor(
    options: { accessToken?: string; client?: ExpoClient } = {},
    private readonly retry: ExpoRetryPolicy = DEFAULT_RETRY,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.client = options.client ?? new Expo(options.accessToken ? { accessToken: options.accessToken } : {});
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    // Jedna wiadomość na token: bilet o tym samym indeksie dotyczy tego tokenu.
    for (const chunk of this.batches(messages)) {
      const expoMessages: ExpoPushMessage[] = chunk.map((m) => ({
        to: m.to,
        ...(m.title ? { title: m.title } : {}),
        body: m.body,
        data: m.data,
        sound: 'default',
        // Kanał Androida tworzy aplikacja przed pobraniem tokenu (ADR 0058).
        channelId: 'default',
        priority: 'high',
      }));
      let result: ExpoPushTicket[];
      try {
        result = await this.withRetry(() => this.client.sendPushNotificationsAsync(expoMessages));
      } catch (error) {
        const message = `ExpoUnavailable: ${(error as Error).message}`;
        this.logger.warn(`Nie wysłano partii ${chunk.length} powiadomień: ${message}`);
        tickets.push(
          ...chunk.map((m) => ({ to: m.to, ok: false as const, error: message, deviceNotRegistered: false })),
        );
        continue;
      }
      result.forEach((ticket, i) => tickets.push(toTicket(chunk[i]!.to, ticket)));
    }
    return tickets;
  }

  async receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>> {
    const receipts = new Map<string, PushReceipt>();
    for (const chunk of this.client.chunkPushNotificationReceiptIds([...ticketIds])) {
      let result: Record<string, ExpoPushReceipt>;
      try {
        result = await this.withRetry(() => this.client.getPushNotificationReceiptsAsync(chunk));
      } catch (error) {
        // Potwierdzenia są dostępne przez dobę; brak odpowiedzi nie zmienia stanu powiadomienia.
        this.logger.warn(`Nie pobrano potwierdzeń: ${(error as Error).message}`);
        continue;
      }
      for (const [id, receipt] of Object.entries(result)) receipts.set(id, toReceipt(receipt));
    }
    return receipts;
  }

  /** Partie do 100 wiadomości; każda wiadomość ma jednego odbiorcę, więc liczba wiadomości to liczba tokenów. */
  private batches(messages: readonly PushMessage[]): PushMessage[][] {
    const batches: PushMessage[][] = [];
    for (let i = 0; i < messages.length; i += EXPO_MAX_BATCH) batches.push(messages.slice(i, i + EXPO_MAX_BATCH));
    return batches;
  }

  private async withRetry<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (attempt >= this.retry.attempts || !isRetryable(error)) throw error;
        const delay = this.retry.baseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(`Expo Push: ${(error as Error).message}; ponowienie za ${delay} ms`);
        await this.sleep(delay);
      }
    }
  }
}

function toTicket(to: string, ticket: ExpoPushTicket): PushTicket {
  if (ticket.status === 'ok') return { to, ok: true, ticketId: ticket.id };
  const code = ticket.details?.error;
  return { to, ok: false, error: code ?? ticket.message, deviceNotRegistered: code === DEVICE_NOT_REGISTERED };
}

function toReceipt(receipt: ExpoPushReceipt): PushReceipt {
  if (receipt.status === 'ok') return { ok: true };
  const code = receipt.details?.error;
  return { ok: false, error: code ?? receipt.message, deviceNotRegistered: code === DEVICE_NOT_REGISTERED };
}
