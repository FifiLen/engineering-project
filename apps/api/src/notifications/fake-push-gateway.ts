import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  DEVICE_NOT_REGISTERED,
  type PushGateway,
  type PushMessage,
  type PushReceipt,
  type PushTicket,
} from './push-gateway.js';

/**
 * Atrapa bramki push (D2, ADR 0058): środowisko deweloperskie, testy i demo bez konta Expo. Każda wiadomość
 * dostaje bilet `fake-…` i trafia do logu API (jak kod SMS), więc powiadomienie ma `SENT` bez dostarczenia.
 * Testy mogą wyrejestrować token od razu (`unregistered`) albo dopiero w potwierdzeniu (`unregisteredLater`).
 */
export class FakePushGateway implements PushGateway {
  readonly name = 'fake' as const;
  private readonly logger = new Logger('Push');
  /** Ostatnie wysłane wiadomości (testy). */
  readonly sent: PushMessage[] = [];
  /** Tokeny odrzucane przy wysyłce z `DeviceNotRegistered`. */
  readonly unregistered = new Set<string>();
  /** Tokeny przyjmowane przy wysyłce, ale z `DeviceNotRegistered` w potwierdzeniu. */
  readonly unregisteredLater = new Set<string>();
  private readonly tickets = new Map<string, string>();

  send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    return Promise.resolve(
      messages.map((message): PushTicket => {
        if (this.unregistered.has(message.to)) {
          return { to: message.to, ok: false, error: DEVICE_NOT_REGISTERED, deviceNotRegistered: true };
        }
        const ticketId = `fake-${randomUUID()}`;
        this.tickets.set(ticketId, message.to);
        this.sent.push(message);
        if (this.sent.length > 200) this.sent.shift();
        const title = message.title ? `${message.title}: ` : '';
        this.logger.log(`${message.to} ${message.data.path ?? ''} ${title}${message.body}`);
        return { to: message.to, ok: true, ticketId };
      }),
    );
  }

  receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>> {
    const receipts = new Map<string, PushReceipt>();
    for (const id of ticketIds) {
      const token = this.tickets.get(id);
      if (token === undefined) continue;
      receipts.set(
        id,
        this.unregisteredLater.has(token)
          ? { ok: false, error: DEVICE_NOT_REGISTERED, deviceNotRegistered: true }
          : { ok: true },
      );
    }
    return Promise.resolve(receipts);
  }
}
