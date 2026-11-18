import { describe, expect, it } from 'vitest';
import {
  autoTicket,
  canAutoCloseOfflineTicket,
  decideTicketUpdate,
  ensureCanAssignTicket,
  isUrgent,
  needsBatteryCriticalTicket,
  shouldOpenOfflineTicket,
  suggestTaskType,
  taskPriorityForTicket,
  ticketStatusOnTaskClosed,
  ticketStatusOnTaskOpened,
  validateTicket,
  type TicketInput,
  type TicketState,
} from './tickets.js';

const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as { code: string; details?: unknown };
    return { code: e.code, details: e.details };
  }
  return null;
};
const input = (overrides: Partial<TicketInput> = {}): TicketInput => ({
  source: 'USER',
  categories: ['BRAKES'],
  description: null,
  photoCount: 0,
  hasRental: false,
  ...overrides,
});

describe('zgłoszenie od klienta i operatora (ADR 0055)', () => {
  it('kategorie bez powtórzeń w kolejności typu i pilność z kategorii', () => {
    expect(validateTicket(input({ categories: ['LIGHTS', 'BRAKES', 'LIGHTS'] }))).toEqual({
      categories: ['BRAKES', 'LIGHTS'],
      description: null,
      urgent: true,
    });
    expect(validateTicket(input({ categories: ['QR_CODE'], description: '  ' }))).toEqual({
      categories: ['QR_CODE'],
      description: null,
      urgent: false,
    });
    expect(isUrgent(['WHEEL'])).toBe(true);
    expect(isUrgent(['HANDLEBAR', 'BATTERY'])).toBe(true);
    expect(isUrgent(['BATTERY', 'LIGHTS'])).toBe(false);
  });

  it('klient nie wybiera kategorii systemowych, a rozliczenie tylko z przejazdem', () => {
    expect(fail(() => validateTicket(input({ categories: [] })))?.code).toBe('TICKET_CATEGORIES_REQUIRED');
    expect(fail(() => validateTicket(input({ categories: ['CONNECTION'] })))).toEqual({
      code: 'TICKET_CATEGORY_NOT_ALLOWED',
      details: { category: 'CONNECTION' },
    });
    expect(fail(() => validateTicket(input({ categories: ['OUT_OF_ZONE'] })))?.code).toBe(
      'TICKET_CATEGORY_NOT_ALLOWED',
    );
    expect(validateTicket(input({ source: 'STAFF', categories: ['OUT_OF_ZONE'] })).categories).toEqual(['OUT_OF_ZONE']);
    expect(fail(() => validateTicket(input({ categories: ['BILLING'], description: 'Naliczono za dużo' })))).toEqual({
      code: 'TICKET_RENTAL_REQUIRED',
      details: { category: 'BILLING' },
    });
    expect(
      validateTicket(input({ categories: ['BILLING'], description: 'Naliczono za dużo', hasRental: true })).categories,
    ).toEqual(['BILLING']);
  });

  it('opis przy rozliczeniu i „inne”, najwyżej 3 zdjęcia', () => {
    expect(fail(() => validateTicket(input({ categories: ['OTHER', 'LIGHTS'] })))).toEqual({
      code: 'TICKET_DESCRIPTION_REQUIRED',
      details: { categories: ['OTHER'] },
    });
    expect(validateTicket(input({ categories: ['OTHER'], description: ' Skrzypi ' })).description).toBe('Skrzypi');
    expect(validateTicket(input({ photoCount: 3 })).urgent).toBe(true);
    expect(fail(() => validateTicket(input({ photoCount: 4 })))).toEqual({
      code: 'TICKET_TOO_MANY_PHOTOS',
      details: { max: 3 },
    });
  });

  it('podpowiedź rodzaju zadania i priorytetu', () => {
    expect(suggestTaskType(['BATTERY'])).toBe('BATTERY_SWAP');
    expect(suggestTaskType(['OUT_OF_ZONE'])).toBe('RELOCATION');
    expect(suggestTaskType(['BRAKES', 'BATTERY'])).toBe('REPAIR');
    expect(suggestTaskType(['CONNECTION'])).toBe('REPAIR');
    expect(suggestTaskType(['BILLING', 'BATTERY'])).toBe('BATTERY_SWAP');
    expect(suggestTaskType(['BILLING'])).toBeNull();
    expect([taskPriorityForTicket(true), taskPriorityForTicket(false)]).toEqual(['HIGH', 'NORMAL']);
  });
});

describe('zgłoszenia automatyczne', () => {
  it('rodzaj wyznacza kategorię i zadanie zakładane od razu', () => {
    expect(autoTicket('OFFLINE')).toEqual({
      source: 'AUTO',
      autoKind: 'OFFLINE',
      categories: ['CONNECTION'],
      urgent: false,
      taskType: null,
    });
    expect(autoTicket('BATTERY_CRITICAL')).toMatchObject({ categories: ['BATTERY'], taskType: 'BATTERY_SWAP' });
    expect(autoTicket('OUT_OF_ZONE')).toMatchObject({ categories: ['OUT_OF_ZONE'], taskType: 'RELOCATION' });
  });

  it('offline po 5 min, bateria poniżej 10% po przejeździe, samozamknięcie bez zadań', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    const since = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(shouldOpenOfflineTicket({ online: false, offlineSince: since(5), now })).toBe(true);
    expect(shouldOpenOfflineTicket({ online: false, offlineSince: since(4.9), now })).toBe(false);
    expect(shouldOpenOfflineTicket({ online: true, offlineSince: since(10), now })).toBe(false);
    expect([needsBatteryCriticalTicket(9), needsBatteryCriticalTicket(10), needsBatteryCriticalTicket(null)]).toEqual([
      true,
      false,
      false,
    ]);
    expect(canAutoCloseOfflineTicket({ autoKind: 'OFFLINE', status: 'IN_PROGRESS', hasTasks: false })).toBe(true);
    expect(canAutoCloseOfflineTicket({ autoKind: 'OFFLINE', status: 'NEW', hasTasks: true })).toBe(false);
    expect(canAutoCloseOfflineTicket({ autoKind: 'OFFLINE', status: 'AT_SERVICE', hasTasks: false })).toBe(false);
    expect(canAutoCloseOfflineTicket({ autoKind: 'BATTERY_CRITICAL', status: 'NEW', hasTasks: false })).toBe(false);
  });
});

describe('statusy zgłoszenia', () => {
  const ticket = (overrides: Partial<TicketState> = {}): TicketState => ({
    status: 'NEW',
    source: 'USER',
    customerReply: null,
    ...overrides,
  });

  it('operator ustawia NEW, IN_PROGRESS i RESOLVED; AT_SERVICE tylko system', () => {
    expect(decideTicketUpdate({ ticket: ticket(), status: 'IN_PROGRESS', openTasks: 0 })).toEqual({
      status: 'IN_PROGRESS',
      statusChanged: true,
      reply: null,
      notifyCustomer: true,
    });
    expect(fail(() => decideTicketUpdate({ ticket: ticket(), status: 'AT_SERVICE', openTasks: 0 }))?.code).toBe(
      'INVALID_TICKET_TRANSITION',
    );
    expect(fail(() => decideTicketUpdate({ ticket: ticket(), status: 'NEW', openTasks: 0 }))?.code).toBe(
      'INVALID_TICKET_TRANSITION',
    );
    expect(
      fail(() => decideTicketUpdate({ ticket: ticket({ status: 'AT_SERVICE' }), status: 'IN_PROGRESS', openTasks: 1 }))
        ?.code,
    ).toBe('TICKET_HAS_OPEN_TASKS');
  });

  it('RESOLVED zgłoszenia klienta wymaga odpowiedzi i braku otwartych zadań; jest stanem końcowym', () => {
    expect(fail(() => decideTicketUpdate({ ticket: ticket(), status: 'RESOLVED', openTasks: 0 }))?.code).toBe(
      'TICKET_REPLY_REQUIRED',
    );
    expect(
      decideTicketUpdate({ ticket: ticket(), status: 'RESOLVED', reply: ' Zwróciliśmy 4,20 zł. ', openTasks: 0 }),
    ).toEqual({ status: 'RESOLVED', statusChanged: true, reply: 'Zwróciliśmy 4,20 zł.', notifyCustomer: true });
    expect(
      decideTicketUpdate({ ticket: ticket({ customerReply: 'Naprawione' }), status: 'RESOLVED', openTasks: 0 }).reply,
    ).toBeNull();
    expect(
      decideTicketUpdate({ ticket: ticket({ source: 'AUTO' }), status: 'RESOLVED', openTasks: 0 }).notifyCustomer,
    ).toBe(false);
    expect(fail(() => decideTicketUpdate({ ticket: ticket(), status: 'RESOLVED', reply: 'x', openTasks: 2 }))).toEqual({
      code: 'TICKET_HAS_OPEN_TASKS',
      details: { openTasks: 2 },
    });
    expect(
      fail(() => decideTicketUpdate({ ticket: ticket({ status: 'RESOLVED' }), status: 'NEW', openTasks: 0 }))?.code,
    ).toBe('TICKET_RESOLVED');
    expect(() => ensureCanAssignTicket('RESOLVED')).toThrow(expect.objectContaining({ code: 'TICKET_RESOLVED' }));
  });

  it('sama odpowiedź bez zmiany statusu tylko w zgłoszeniu klienta', () => {
    expect(
      decideTicketUpdate({ ticket: ticket({ status: 'IN_PROGRESS' }), reply: 'Sprawdzamy', openTasks: 0 }),
    ).toEqual({
      status: 'IN_PROGRESS',
      statusChanged: false,
      reply: 'Sprawdzamy',
      notifyCustomer: true,
    });
    expect(
      fail(() => decideTicketUpdate({ ticket: ticket({ source: 'STAFF' }), reply: 'x', openTasks: 0 }))?.code,
    ).toBe('TICKET_REPLY_NOT_ALLOWED');
  });

  it('zadania ze zgłoszenia: AT_SERVICE przy pierwszym, RESOLVED albo powrót do dyspozytora po ostatnim', () => {
    expect(ticketStatusOnTaskOpened('IN_PROGRESS')).toBe('AT_SERVICE');
    expect(fail(() => ticketStatusOnTaskOpened('RESOLVED'))?.code).toBe('TICKET_RESOLVED');
    expect(ticketStatusOnTaskClosed({ status: 'AT_SERVICE', openTasks: 1, doneTasks: 1 })).toBeNull();
    expect(ticketStatusOnTaskClosed({ status: 'AT_SERVICE', openTasks: 0, doneTasks: 1 })).toBe('RESOLVED');
    expect(ticketStatusOnTaskClosed({ status: 'AT_SERVICE', openTasks: 0, doneTasks: 0 })).toBe('IN_PROGRESS');
    expect(ticketStatusOnTaskClosed({ status: 'RESOLVED', openTasks: 0, doneTasks: 1 })).toBeNull();
  });
});
