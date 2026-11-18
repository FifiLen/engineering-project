import { describe, expect, it } from 'vitest';
import { notificationDedupeKey, notificationDelivery } from './notifications.js';
import { renderTemplate, templateIssues, validateTemplate, type TemplateParamSpec } from './templates.js';

// Parametry `ride_ended` z rejestru w packages/shared.
const rideEnded: TemplateParamSpec[] = [
  { name: 'rideNumber', type: 'text' },
  { name: 'minutes', type: 'number' },
  { name: 'amount', type: 'text' },
  { name: 'hasReceipt', type: 'select', options: ['true', 'false'] },
];
const body = [
  'Przejazd {rideNumber} trwał {minutes, plural,',
  '  one {# minutę} few {# minuty}',
  '  many {# minut} other {# minuty}',
  '}. Koszt: {amount}.',
  '{hasReceipt, select, true {Paragon czeka w aplikacji.} other {}}',
].join('\n');
const push = (overrides: { title?: string | null; body?: string } = {}) => ({
  channel: 'PUSH' as const,
  title: 'Przejazd zakończony',
  body,
  ...overrides,
});
const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as { code: string; details?: Record<string, unknown> };
    return { code: e.code, details: e.details };
  }
  return null;
};

describe('walidacja szablonu ICU (ADR 0058)', () => {
  it('poprawny szablon nie ma problemów', () => {
    expect(templateIssues(push(), rideEnded)).toEqual([]);
    expect(() => validateTemplate(push(), rideEnded)).not.toThrow();
  });

  it('błąd składni z wierszem i znakiem', () => {
    const broken = body.replace('other {}}', 'other {}');
    const error = fail(() => validateTemplate(push({ body: broken }), rideEnded));
    expect(error?.code).toBe('TEMPLATE_SYNTAX_ERROR');
    expect(error?.details).toMatchObject({ field: 'body', kind: 'EXPECT_ARGUMENT_CLOSING_BRACE', line: 5 });
    expect(error?.details?.column).toBeTypeOf('number');
    expect(templateIssues(push({ body: 'Koszt {amount' }), rideEnded)).toEqual([
      { code: 'TEMPLATE_SYNTAX_ERROR', field: 'body', kind: 'EXPECT_ARGUMENT_CLOSING_BRACE', line: 1, column: 7 },
    ]);
  });

  it('parametr wymagany przez rejestr musi być w tytule albo treści (SMS logowania bez kodu)', () => {
    const loginCode: TemplateParamSpec[] = [{ name: 'code', type: 'text', required: true }];
    const sms = (text: string) => ({ channel: 'SMS' as const, title: null, body: text });
    expect(templateIssues(sms('{code} to Twój kod logowania.'), loginCode)).toEqual([]);
    expect(fail(() => validateTemplate(sms('Twój kod logowania jest w drodze.'), loginCode))).toMatchObject({
      code: 'TEMPLATE_MISSING_PARAM',
      details: { field: 'body', param: 'code' },
    });
    // Parametr użyty tylko w gałęzi `select` też się liczy; przy błędzie składni zostaje tylko błąd składni.
    const required = rideEnded.map((p) => (p.name === 'amount' ? { ...p, required: true } : p));
    expect(
      templateIssues(push({ body: '{hasReceipt, select, true {Koszt {amount}} other {Koszt {amount}}}' }), required),
    ).toEqual([]);
    expect(templateIssues(push({ body: 'Koszt {amount' }), required).map((i) => i.code)).toEqual([
      'TEMPLATE_SYNTAX_ERROR',
    ]);
  });

  it('parametr spoza rejestru, także w tytule i w gałęzi odmiany', () => {
    expect(fail(() => validateTemplate(push({ title: 'Przejazd {rentalNo}' }), rideEnded))).toMatchObject({
      code: 'TEMPLATE_UNKNOWN_PARAM',
      details: { field: 'title', param: 'rentalNo', line: 1, column: 10 },
    });
    const nested = '{minutes, plural, one {# min, {extra}} other {# min}}';
    expect(templateIssues(push({ body: nested }), rideEnded)).toMatchObject([
      { code: 'TEMPLATE_UNKNOWN_PARAM', param: 'extra' },
    ]);
  });

  it('odmiana tylko dla liczb, bez formatów dat, wartości wyboru z rejestru', () => {
    expect(templateIssues(push({ body: '{amount, plural, other {#}}' }), rideEnded)).toMatchObject([
      { code: 'TEMPLATE_PARAM_TYPE', param: 'amount' },
    ]);
    expect(templateIssues(push({ body: '{rideNumber, date}' }), rideEnded)).toMatchObject([
      { code: 'TEMPLATE_PARAM_TYPE', param: 'rideNumber' },
    ]);
    expect(templateIssues(push({ body: '{hasReceipt, select, yes {Paragon} other {}}' }), rideEnded)).toMatchObject([
      { code: 'TEMPLATE_UNKNOWN_OPTION', param: 'hasReceipt', option: 'yes' },
    ]);
  });

  it('limity znaków, wymagana treść, tytuł tylko w push', () => {
    expect(templateIssues(push({ title: 'x'.repeat(51) }), rideEnded)).toEqual([
      { code: 'TEMPLATE_TOO_LONG', field: 'title', max: 50, length: 51 },
    ]);
    expect(templateIssues(push({ body: 'ą'.repeat(240) }), rideEnded)).toEqual([]);
    expect(templateIssues(push({ body: 'ą'.repeat(241) }), rideEnded)[0]).toMatchObject({ code: 'TEMPLATE_TOO_LONG' });
    const code = [{ name: 'code', type: 'text' }] as const;
    const sms = { channel: 'SMS' as const, title: null, body: 'Kod logowania: {code}' };
    expect(templateIssues(sms, code)).toEqual([]);
    expect(templateIssues({ ...sms, body: 'x'.repeat(161) }, code)[0]).toMatchObject({ max: 160 });
    expect(templateIssues({ ...sms, title: 'Kod' }, code)).toEqual([{ code: 'VALIDATION_FAILED', field: 'title' }]);
    expect(templateIssues(push({ title: ' ', body: ' ' }), rideEnded)).toEqual([
      { code: 'VALIDATION_FAILED', field: 'title' },
      { code: 'VALIDATION_FAILED', field: 'body' },
    ]);
    expect(fail(() => validateTemplate(push({ title: null, body: ' ' }), rideEnded))?.details?.issues).toHaveLength(2);
  });
});

describe('renderowanie z lokalizacją pl', () => {
  it('odmienia liczebniki i wybiera gałąź z wartości logicznej', () => {
    const render = (minutes: number, hasReceipt: boolean) =>
      renderTemplate(push(), { rideNumber: 'R-51858', minutes, amount: '19,60 zł', hasReceipt }).body;
    expect(render(24, true)).toBe('Przejazd R-51858 trwał 24 minuty. Koszt: 19,60 zł.\nParagon czeka w aplikacji.');
    expect(render(1, false)).toBe('Przejazd R-51858 trwał 1 minutę. Koszt: 19,60 zł.\n');
    expect(render(5, false)).toContain('5 minut.');
    expect(renderTemplate(push(), { rideNumber: '1', minutes: 1, amount: '1', hasReceipt: false }).title).toBe(
      'Przejazd zakończony',
    );
  });

  it('brak wartości parametru kończy się błędem domeny, SMS bez tytułu', () => {
    expect(fail(() => renderTemplate(push(), { rideNumber: 'R-1' }))?.code).toBe('TEMPLATE_RENDER_FAILED');
    expect(renderTemplate({ title: null, body: 'Kod: {code}' }, { code: '481 516' })).toEqual({
      title: null,
      body: 'Kod: 481 516',
    });
  });
});

describe('decyzja o wysyłce', () => {
  const preferences = { reservationEnd: false, receipts: true };

  it('preferencje dotyczą tylko końca rezerwacji i paragonów', () => {
    expect(notificationDelivery({ code: 'reservation_ending', channel: 'PUSH', preferences, pushTokens: 1 })).toEqual({
      send: false,
      reason: 'PREFERENCE_DISABLED',
    });
    expect(notificationDelivery({ code: 'ride_ended', channel: 'PUSH', preferences, pushTokens: 1 })).toEqual({
      send: true,
    });
    const off = { reservationEnd: false, receipts: false };
    for (const code of ['battery_low', 'payment_failed', 'ticket_received', 'ticket_status_changed'] as const) {
      expect(notificationDelivery({ code, channel: 'PUSH', preferences: off, pushTokens: 1 })).toEqual({ send: true });
    }
  });

  it('push bez tokenu jest pomijany, SMS idzie zawsze; klucz idempotencji z kodu i zdarzenia', () => {
    expect(notificationDelivery({ code: 'battery_low', channel: 'PUSH', preferences, pushTokens: 0 })).toEqual({
      send: false,
      reason: 'NO_PUSH_TOKEN',
    });
    expect(notificationDelivery({ code: 'login_code', channel: 'SMS', preferences, pushTokens: 0 })).toEqual({
      send: true,
    });
    expect(notificationDedupeKey('battery_low', 'r1', 'CRITICAL')).toBe('battery_low:r1:CRITICAL');
  });
});
