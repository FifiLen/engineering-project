import { Injectable, Logger } from '@nestjs/common';

/** Bramka SMS za adapterem (ADR 0019); dostawca produkcyjny to osobna implementacja. */
export abstract class SmsGateway {
  abstract send(phone: string, text: string): Promise<void>;
}

/**
 * Środowisko deweloperskie i testy: wiadomość trafia do logu API (kod widać w terminalu), a ostatnie
 * wiadomości są w pamięci, żeby test mógł odczytać kod.
 */
@Injectable()
export class LoggingSmsGateway extends SmsGateway {
  private readonly logger = new Logger('SMS');
  readonly sent: Array<{ phone: string; text: string }> = [];

  send(phone: string, text: string): Promise<void> {
    this.sent.push({ phone, text });
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`${phone}: ${text}`);
    return Promise.resolve();
  }
}
