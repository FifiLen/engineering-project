import { topics } from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { CONFIG, type AppConfig } from '../config.js';

export type MqttHandler = (topic: string, payload: Buffer) => void;

/**
 * Połączenie backendu z brokerem (ADR 0011). Backend subskrybuje telemetrię, status i potwierdzenia
 * całej floty i publikuje komendy; moduły rejestrują obsługę swoich tematów.
 */
@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  private readonly handlers: MqttHandler[] = [];
  /** Publikacje przy wyłączonym MQTT (testy). */
  readonly published: Array<{ topic: string; payload: unknown }> = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Połączenie dopiero po inicjalizacji wszystkich modułów: przy trwałej sesji broker od razu dosyła
   * zaległe wiadomości, więc obsługa tematów musi być już zarejestrowana.
   */
  onApplicationBootstrap(): void {
    if (!this.config.MQTT_ENABLED) return;
    this.client = mqtt.connect(this.config.MQTT_URL, {
      // Stały identyfikator i sesja trwała: wiadomości QoS 1 z czasu restartu backendu czekają w brokerze.
      clientId: this.config.MQTT_CLIENT_ID,
      clean: false,
      reconnectPeriod: 2000,
    });
    this.client.on('connect', () => {
      this.logger.log(`Połączono z brokerem ${this.config.MQTT_URL}`);
      this.client!.subscribe([topics.allTelemetry, topics.allStatus, topics.allAcks], { qos: 1 });
    });
    this.client.on('error', (error) => this.logger.warn(`MQTT: ${error.message}`));
    this.client.on('message', (topic, payload) => this.dispatch(topic, payload));
  }

  onMessage(handler: MqttHandler): void {
    this.handlers.push(handler);
  }

  /** Wiadomość z brokera (albo z testu) trafia do wszystkich zarejestrowanych modułów. */
  dispatch(topic: string, payload: Buffer): void {
    for (const handler of this.handlers) {
      try {
        handler(topic, payload);
      } catch (error) {
        this.logger.error(`Błąd obsługi ${topic}: ${(error as Error).message}`);
      }
    }
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    if (!this.client) {
      this.published.push({ topic, payload });
      return;
    }
    await this.client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.endAsync();
  }
}
