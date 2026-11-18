import { commandSchema, lastWillPayload, scooterTopicId, topics, type Status, type Telemetry } from '@hulajnogi/shared';
import mqtt, { type MqttClient } from 'mqtt';
import type { VirtualScooter } from './virtual-scooter.js';

/** Bufor telemetrii bez łączności: godzina punktów co 5 s. */
const MAX_BUFFERED = 720;

export interface ConnectionStats {
  sent: number;
  /** Komendy odebrane od startu i te z nich, których hulajnoga nie potwierdziła (milczenie). */
  commandsReceived: number;
  commandsUnacked: number;
}

/** Część połączenia, którą sterują scenariusze symulatora (ADR 0059); w testach zastępowana atrapą. */
export interface ScooterLink {
  readonly number: number;
  /** Komendy bez potwierdzenia od włączenia milczenia. */
  readonly unacked: number;
  /** Punkty telemetrii czekające na powrót łączności. */
  readonly buffered: number;
  setOffline(offline: boolean): void;
  setSilent(silent: boolean): void;
}

/**
 * Własne połączenie MQTT każdej hulajnogi (ADR 0002): Last Will na kanale status, komendy QoS 1,
 * bufor telemetrii dosyłany po odzyskaniu łączności z oryginalnymi znacznikami czasu (ADR 0056: z bufora
 * backend wykrywa jazdę po żądaniu zakończenia). Awarie do demo (ADR 0039, ADR 0059) włączają scenariusze:
 * rozłączenie zrywa połączenie, milczenie wstrzymuje potwierdzenia.
 */
export class ScooterConnection implements ScooterLink {
  private readonly client: MqttClient;
  private readonly id: string;
  private readonly buffer: Telemetry[] = [];
  private offline = false;
  /** Hulajnoga wykonuje komendy, ale nie wysyła potwierdzeń (demo nieudanego odblokowania). */
  private silent = false;
  unacked = 0;

  constructor(
    private readonly scooter: VirtualScooter,
    url: string,
    private readonly firmware: string,
    private readonly stats: ConnectionStats,
  ) {
    this.id = scooterTopicId(scooter.number);
    this.client = mqtt.connect(url, {
      clientId: `scooter-${this.id}`,
      clean: false,
      reconnectPeriod: 3000,
      will: {
        topic: topics.status(this.id),
        payload: Buffer.from(JSON.stringify(lastWillPayload)),
        qos: 1,
        retain: true,
      },
    });
    this.client.on('connect', () => this.onConnect());
    this.client.on('message', (_topic, payload) => this.onCommand(payload));
    this.client.on('error', () => undefined);
  }

  get number(): number {
    return this.scooter.number;
  }

  get connected(): boolean {
    return this.client.connected;
  }

  /**
   * Symulowana utrata łączności: zerwanie gniazda bez pakietu DISCONNECT, więc broker publikuje Last Will
   * i przechowuje komendy w sesji trwałej. Po powrocie hulajnoga dostaje je z opóźnieniem (ADR 0038).
   */
  setOffline(offline: boolean): void {
    if (offline === this.offline) return;
    this.offline = offline;
    if (offline) this.client.end(true);
    else this.client.reconnect();
  }

  setSilent(silent: boolean): void {
    if (silent && !this.silent) this.unacked = 0;
    this.silent = silent;
  }

  get buffered(): number {
    return this.buffer.length;
  }

  private onConnect(): void {
    const status: Status = { online: true, firmware: this.firmware, since: new Date().toISOString() };
    this.publish(topics.status(this.id), status, true);
    this.client.subscribe(topics.command(this.id), { qos: 1 });
    for (const point of this.buffer.splice(0)) this.publish(topics.telemetry(this.id), { ...point, buffered: true });
  }

  private onCommand(payload: Buffer): void {
    let parsed;
    try {
      parsed = commandSchema.safeParse(JSON.parse(payload.toString('utf8')));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const ack = this.scooter.handle(parsed.data, new Date());
    this.stats.commandsReceived++;
    if (!this.silent) return this.publish(topics.ack(this.id), ack);
    this.stats.commandsUnacked++;
    this.unacked++;
  }

  sendTelemetry(now: Date): void {
    const point = this.scooter.telemetry(now);
    if (this.client.connected) this.publish(topics.telemetry(this.id), point);
    else if (this.buffer.push(point) > MAX_BUFFERED) this.buffer.shift();
  }

  private publish(topic: string, payload: unknown, retain = false): void {
    this.client.publish(topic, JSON.stringify(payload), { qos: 1, retain });
    this.stats.sent++;
  }

  /** Zamknięcie z ogłoszeniem offline; zwykłe rozłączenie nie wyzwala Last Will. */
  async close(): Promise<void> {
    if (this.client.connected) {
      await this.client.publishAsync(topics.status(this.id), JSON.stringify(lastWillPayload), { qos: 1, retain: true });
    }
    await this.client.endAsync();
  }
}
