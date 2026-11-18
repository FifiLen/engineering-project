import { Injectable, Logger } from '@nestjs/common';
import type { TemplateValues } from '@hulajnogi/core';
import { NotificationTemplatesService } from '../notifications/notification-templates.service.js';

/** Szablony kanału SMS z rejestru powiadomień (ADR 0058). */
export type SmsTemplateCode = 'login_code';

/**
 * Bramka SMS za adapterem (ADR 0019); dostawca produkcyjny to osobna implementacja. Treść pochodzi z szablonu
 * kanału SMS z panelu (ADR 0058, wymaganie 17), więc API nie ma tekstów dla klienta na sztywno.
 */
export abstract class SmsGateway {
  constructor(private readonly templates: NotificationTemplatesService) {}

  /**
   * Treść z bieżącej wersji szablonu; brak szablonu (`TEMPLATE_MISSING`) albo wartości kończy się błędem. Logowanie
   * renderuje treść przed zapisem kodu, żeby zepsuty szablon nie zużywał limitu kodów klienta.
   */
  async render(code: SmsTemplateCode, values: TemplateValues): Promise<string> {
    return (await this.templates.render(code, values)).body;
  }

  async sendTemplate(phone: string, code: SmsTemplateCode, values: TemplateValues): Promise<void> {
    await this.deliver(phone, await this.render(code, values));
  }

  /** Wysyłka gotowej treści (z `render`). */
  deliver(phone: string, text: string): Promise<void> {
    return this.send(phone, text);
  }

  protected abstract send(phone: string, text: string): Promise<void>;
}

/**
 * Środowisko deweloperskie i testy: wiadomość trafia do logu API (kod widać w terminalu), a ostatnie
 * wiadomości są w pamięci, żeby test mógł odczytać kod.
 */
@Injectable()
export class LoggingSmsGateway extends SmsGateway {
  private readonly logger = new Logger('SMS');
  readonly sent: Array<{ phone: string; text: string }> = [];

  constructor(templates: NotificationTemplatesService) {
    super(templates);
  }

  protected send(phone: string, text: string): Promise<void> {
    this.sent.push({ phone, text });
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`${phone}: ${text}`);
    return Promise.resolve();
  }
}
