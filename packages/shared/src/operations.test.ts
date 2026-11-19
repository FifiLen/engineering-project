import { describe, expect, it } from 'vitest';
import { commandSchema } from './mqtt.js';
import {
  isNotificationTemplateCode,
  NOTIFICATION_TEMPLATE_CODES,
  NOTIFICATION_TEMPLATES,
  notificationPath,
  notificationTemplatePreviewSchema,
  pushTokenSchema,
  TEMPLATE_PARAM_TYPES,
} from './notifications.js';
import { remoteEndSchema } from './admin/rentals.js';
import { partAdjustmentSchema, serviceTaskCreateSchema, taskPartAddSchema } from './service.js';
import {
  simulatorCommandRequestSchema,
  simulatorControlSchema,
  simulatorResultSchema,
  simulatorStatusSchema,
} from './simulator.js';
import { customerTicketCreateSchema, ticketLabel, ticketStatusChangeSchema } from './tickets.js';

const uuid = '6f1c2d0e-3b1a-4b8e-9b55-0a1f4c2e7d10';
const uuid2 = '0b7e4a35-91d2-4f3c-8a64-2c5d1e9f7a21';

describe('rejestr szablonów powiadomień (ADR 0058)', () => {
  it('ma dokładnie kody zdarzeń iteracji 6 i 7 z kanałem i parametrami', () => {
    expect(NOTIFICATION_TEMPLATE_CODES).toEqual([
      'reservation_ending',
      'ride_ended',
      'payment_failed',
      'battery_low',
      'ticket_received',
      'ticket_status_changed',
      'login_code',
      'data_export_ready',
    ]);
    const params = (code: keyof typeof NOTIFICATION_TEMPLATES) =>
      NOTIFICATION_TEMPLATES[code].params.map((p) => `${p.name}:${p.type}`);
    expect(params('reservation_ending')).toEqual(['scooterNumber:text', 'minutesLeft:number']);
    expect(params('ride_ended').slice(0, 4)).toEqual([
      'rideNumber:text',
      'minutes:number',
      'amount:text',
      'hasReceipt:select',
    ]);
    expect(params('payment_failed')).toEqual(['rideNumber:text', 'amount:text']);
    expect(params('battery_low')).toEqual(['scooterNumber:text', 'batteryPct:number']);
    expect(params('ticket_received')).toEqual(['ticketNumber:text', 'scooterNumber:text']);
    expect(params('ticket_status_changed')).toEqual(['ticketNumber:text', 'status:select', 'reply:text']);
    expect(params('login_code')).toEqual(['code:text']);
    expect(NOTIFICATION_TEMPLATES.login_code.channel).toBe('SMS');
    expect(params('data_export_ready')).toEqual(['expiresAt:text']);
    expect(NOTIFICATION_TEMPLATES.data_export_ready.preference).toBeNull();
    expect(notificationPath('data_export_ready')).toBe('/profil/moje-dane');
  });

  it('parametry są poprawne: nazwy bez powtórzeń, typy z listy, wybór z wartościami', () => {
    for (const code of NOTIFICATION_TEMPLATE_CODES) {
      expect(code).toMatch(/^[a-z_]+$/);
      const { params } = NOTIFICATION_TEMPLATES[code];
      expect(new Set(params.map((p) => p.name)).size).toBe(params.length);
      for (const param of params) {
        expect(param.name).toMatch(/^[a-z][A-Za-z]*$/);
        expect(TEMPLATE_PARAM_TYPES).toContain(param.type);
        expect(param.type === 'select').toBe(Boolean('options' in param && param.options?.length));
      }
    }
  });

  it('ekran otwierany z powiadomienia i preferencje', () => {
    expect(notificationPath('ride_ended', 'r-1')).toBe('/podsumowanie/r-1');
    expect(notificationPath('battery_low')).toBe('/przejazd');
    expect(notificationPath('login_code')).toBeNull();
    expect(NOTIFICATION_TEMPLATES.reservation_ending.preference).toBe('reservationEnd');
    expect(NOTIFICATION_TEMPLATES.ride_ended.preference).toBe('receipts');
    expect(isNotificationTemplateCode('ride_ended')).toBe(true);
    expect(isNotificationTemplateCode('toString')).toBe(false);
  });

  it('token push Expo i podgląd szablonu', () => {
    expect(
      pushTokenSchema.parse({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'IOS' }).platform,
    ).toBe('IOS');
    expect(() => pushTokenSchema.parse({ token: 'abc', platform: 'IOS' })).toThrow();
    expect(() => pushTokenSchema.parse({ token: 'ExpoPushToken[a]', platform: 'WEB' })).toThrow();
    expect(notificationTemplatePreviewSchema.parse({ title: 'x', body: 'y' }).values).toEqual({});
  });
});

describe('schematy zgłoszeń i serwisu', () => {
  it('zgłoszenie klienta: kategorie klienta, najwyżej 3 zdjęcia', () => {
    const parsed = customerTicketCreateSchema.parse({ scooterId: uuid, categories: ['BRAKES'] });
    expect(parsed).toEqual({
      scooterId: uuid,
      rentalId: null,
      categories: ['BRAKES'],
      description: null,
      photoIds: [],
    });
    expect(() => customerTicketCreateSchema.parse({ scooterId: uuid, categories: ['CONNECTION'] })).toThrow();
    expect(() => customerTicketCreateSchema.parse({ scooterId: uuid, categories: [] })).toThrow();
    expect(() =>
      customerTicketCreateSchema.parse({ scooterId: uuid, categories: ['OTHER'], photoIds: [uuid, uuid, uuid, uuid] }),
    ).toThrow();
    expect(ticketLabel(1042)).toBe('Z-1042');
  });

  it('zmiana statusu wymaga statusu albo odpowiedzi', () => {
    expect(ticketStatusChangeSchema.parse({ version: 1, reply: ' Sprawdzamy ' })).toEqual({
      version: 1,
      reply: 'Sprawdzamy',
      note: null,
    });
    expect(() => ticketStatusChangeSchema.parse({ version: 1 })).toThrow();
    expect(() => ticketStatusChangeSchema.parse({ version: 1, status: 'AT_SERVICE' })).toThrow();
  });

  it('zadanie z celem przewiezienia, części i korekta stanu', () => {
    const task = serviceTaskCreateSchema.parse({ scooterId: uuid, type: 'RELOCATION', target: { zoneId: uuid2 } });
    expect(task).toMatchObject({ priority: 'NORMAL', ticketId: null, target: { zoneId: uuid2 } });
    expect(
      serviceTaskCreateSchema.parse({
        scooterId: uuid,
        type: 'RELOCATION',
        target: { point: { lat: 50.1, lon: 18.5 } },
      }).target,
    ).toEqual({ point: { lat: 50.1, lon: 18.5 } });
    expect(() =>
      serviceTaskCreateSchema.parse({
        scooterId: uuid,
        type: 'RELOCATION',
        target: { zoneId: uuid2, point: { lat: 1, lon: 1 } },
      }),
    ).toThrow();
    expect(() => taskPartAddSchema.parse({ partId: uuid, quantity: 0 })).toThrow();
    expect(() => partAdjustmentSchema.parse({ version: 1, newQty: -1, reason: 'STOCKTAKE' })).toThrow();
    expect(() => partAdjustmentSchema.parse({ version: 1, newQty: 2, reason: 'MISTAKE' })).toThrow();
    expect(partAdjustmentSchema.parse({ version: 1, newQty: 2, reason: 'OTHER', note: ' Pomyłka ' })).toEqual({
      version: 1,
      newQty: 2,
      reason: 'OTHER',
      note: 'Pomyłka',
    });
  });

  it('zdalne zakończenie domyślnie bez opłaty za odholowanie', () => {
    expect(remoteEndSchema.parse({ reason: 'CUSTOMER_REQUEST' })).toEqual({
      reason: 'CUSTOMER_REQUEST',
      note: null,
      collectTowingFee: false,
    });
  });
});

describe('kontrakt MQTT 1.3.0 i kontrakt symulatora 1.0.0 (ADR 0059)', () => {
  it('komenda battery_swapped bez parametrów', () => {
    expect(
      commandSchema.parse({ commandId: uuid, cmd: 'battery_swapped', issuedAt: '2026-11-18T10:00:00.000Z' }).cmd,
    ).toBe('battery_swapped');
  });

  it('polecenie z panelu: parametry według akcji, rozładowanie z wartościami domyślnymi', () => {
    expect(simulatorCommandRequestSchema.parse({ scooter: 12, action: 'drain', params: {} })).toEqual({
      scooter: 12,
      action: 'drain',
      params: { targetPct: 5, durationS: 30 },
    });
    expect(simulatorCommandRequestSchema.parse({ scooter: 7, action: 'disconnect' })).toEqual({
      scooter: 7,
      action: 'disconnect',
      params: {},
    });
    expect(
      simulatorCommandRequestSchema.parse({ scooter: 15, action: 'goto', params: { point: { lat: 50.1, lon: 18.5 } } })
        .params,
    ).toEqual({ point: { lat: 50.1, lon: 18.5 } });
    expect(() => simulatorCommandRequestSchema.parse({ scooter: 15, action: 'goto', params: {} })).toThrow();
    expect(() => simulatorCommandRequestSchema.parse({ scooter: 15, action: 'enter_no_ride', params: {} })).toThrow();
    expect(() => simulatorCommandRequestSchema.parse({ scooter: 15, action: 'explode' })).toThrow();
  });

  it('wiadomość simulator/control, wynik i rozszerzony stan', () => {
    const control = simulatorControlSchema.parse({
      commandId: uuid,
      action: 'enter_no_ride',
      scooter: 7,
      params: { zoneId: uuid2 },
      issuedBy: uuid2,
      expiresAt: '2026-11-18T10:00:30.000Z',
    });
    expect(control.action).toBe('enter_no_ride');
    expect(simulatorResultSchema.parse({ commandId: uuid, ok: false, reason: 'SCENARIO_ACTIVE' }).ok).toBe(false);
    expect(simulatorStatusSchema.parse({ online: false })).toEqual({ online: false });
    // Stan symulatora sprzed iteracji 6 nadal przechodzi (bez scenariuszy).
    const legacy = simulatorStatusSchema.parse({
      online: true,
      since: '2026-11-18T08:00:00.000Z',
      fleetSize: 240,
      connected: 238,
      riding: 6,
      messagesPerSecond: 48,
      ridesPerHour: 30,
    });
    expect(legacy.online && legacy.scenarios).toEqual([]);
    const current = simulatorStatusSchema.parse({
      ...legacy,
      updatedAt: '2026-11-18T10:14:00.000Z',
      scenarios: [
        {
          scooter: 12,
          kind: 'drain',
          startedAt: '2026-11-18T10:13:40.000Z',
          progress: { batteryPct: 41, targetPct: 5, remainingS: 18 },
        },
      ],
    });
    expect(current.online && current.scenarios[0]?.progress.batteryPct).toBe(41);
  });
});
