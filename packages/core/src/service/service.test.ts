import { describe, expect, it } from 'vitest';
import {
  ensureCanRetire,
  ensureCanReturnToFleet,
  fleetFormStatusChange,
  maintenanceEffect,
  reasonAfterUrgentTicketResolved,
  returnToFleetBlockers,
  scooterStatusAfterRental,
  statusAfterService,
} from './scooter-service.js';
import {
  availableTaskTypes,
  decideTaskCancel,
  decideTaskComplete,
  decideTaskStart,
  ServiceTaskStateMachine,
  validateNewTask,
  type ServiceTaskState,
} from './service-tasks.js';
import {
  ensurePartReceipt,
  ensurePartReturn,
  ensurePartUse,
  ensureStockAdjustment,
  ensureTaskAcceptsParts,
  isBelowMinimum,
  partsCost,
} from './spare-parts.js';

const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as { code: string; details?: unknown };
    return { code: e.code, details: e.details };
  }
  return null;
};
const task = (overrides: Partial<ServiceTaskState> = {}): ServiceTaskState => ({
  type: 'REPAIR',
  status: 'OPEN',
  assigneeId: null,
  ...overrides,
});

describe('zadania serwisowe (ADR 0055)', () => {
  it('rozpoczęcie przypisuje nieprzypisane zadanie do operatora', () => {
    expect(decideTaskStart(task(), 'st1')).toEqual({ to: 'IN_PROGRESS', assigneeId: 'st1' });
    expect(decideTaskStart(task({ assigneeId: 'st1' }), 'st1').assigneeId).toBe('st1');
    expect(fail(() => decideTaskStart(task({ assigneeId: 'st2' }), 'st1'))).toEqual({
      code: 'TASK_ASSIGNED_TO_OTHER',
      details: { assigneeId: 'st2' },
    });
    expect(fail(() => decideTaskStart(task({ status: 'IN_PROGRESS', assigneeId: 'st1' }), 'st1'))).toEqual({
      code: 'INVALID_TASK_TRANSITION',
      details: { from: 'IN_PROGRESS', action: 'START' },
    });
  });

  it('zakończenie z notatką, wymiana baterii wysyła battery_swapped', () => {
    const running = task({ status: 'IN_PROGRESS', assigneeId: 'st1' });
    expect(decideTaskComplete(running, ' Wymieniono klocki ')).toEqual({
      to: 'DONE',
      note: 'Wymieniono klocki',
      sendBatterySwapped: false,
    });
    expect(decideTaskComplete({ ...running, type: 'BATTERY_SWAP' }, 'Nowa bateria').sendBatterySwapped).toBe(true);
    expect(fail(() => decideTaskComplete(running, '  '))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { field: 'note' },
    });
    expect(fail(() => decideTaskComplete(task(), 'x'))?.code).toBe('INVALID_TASK_TRANSITION');
  });

  it('anulowanie z powodem z OPEN i IN_PROGRESS, zamkniętego zadania nie da się wznowić', () => {
    expect(decideTaskCancel(task(), 'Duplikat')).toEqual({ to: 'CANCELLED', reason: 'Duplikat' });
    expect(decideTaskCancel(task({ status: 'IN_PROGRESS', assigneeId: 'st1' }), 'x').to).toBe('CANCELLED');
    expect(fail(() => decideTaskCancel(task(), null))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { field: 'reason' },
    });
    for (const closed of ['DONE', 'CANCELLED'] as const) {
      expect(ServiceTaskStateMachine.isOpen(closed)).toBe(false);
      for (const action of ['START', 'COMPLETE', 'CANCEL'] as const) {
        expect(ServiceTaskStateMachine.next(closed, action)).toBeUndefined();
      }
    }
  });

  it('rodzaj otwarty na hulajnodze jest niedostępny, cel tylko przy przewiezieniu', () => {
    const base = { scooterStatus: 'AVAILABLE', openTypes: ['BATTERY_SWAP'], target: null } as const;
    expect(availableTaskTypes(['BATTERY_SWAP'])).toEqual(['REPAIR', 'INSPECTION', 'RELOCATION']);
    expect(validateNewTask({ ...base, type: 'REPAIR' })).toEqual({ target: null });
    expect(fail(() => validateNewTask({ ...base, type: 'BATTERY_SWAP' }))).toEqual({
      code: 'SERVICE_TASK_TYPE_OPEN',
      details: { type: 'BATTERY_SWAP' },
    });
    expect(fail(() => validateNewTask({ ...base, type: 'REPAIR', scooterStatus: 'RETIRED' }))?.code).toBe(
      'SCOOTER_RETIRED',
    );
    expect(validateNewTask({ ...base, type: 'RELOCATION', target: { zoneId: 'z1' } })).toEqual({
      target: { zoneId: 'z1' },
    });
    const point = { lat: 50.09, lon: 18.54 };
    expect(validateNewTask({ ...base, type: 'RELOCATION', target: { point } })).toEqual({ target: { point } });
    for (const target of [null, { zoneId: 'z1', point }]) {
      expect(fail(() => validateNewTask({ ...base, type: 'RELOCATION', target }))?.details).toEqual({
        field: 'target',
      });
    }
    expect(fail(() => validateNewTask({ ...base, type: 'REPAIR', target: { zoneId: 'z1' } }))?.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('magazyn części', () => {
  it('użycie nie przekracza stanu, części tylko w zadaniu w toku', () => {
    expect(() => ensurePartUse({ stockQty: 2, quantity: 2 })).not.toThrow();
    expect(fail(() => ensurePartUse({ stockQty: 2, quantity: 3 }))).toEqual({
      code: 'PART_OUT_OF_STOCK',
      details: { available: 2 },
    });
    expect(fail(() => ensurePartUse({ stockQty: 2, quantity: 0 }))?.code).toBe('VALIDATION_FAILED');
    expect(fail(() => ensurePartUse({ stockQty: 2, quantity: 1, active: false }))?.code).toBe('PART_INACTIVE');
    expect(() => ensureTaskAcceptsParts('IN_PROGRESS')).not.toThrow();
    for (const status of ['OPEN', 'DONE', 'CANCELLED'] as const) {
      expect(fail(() => ensureTaskAcceptsParts(status))).toEqual({ code: 'TASK_NOT_IN_PROGRESS', details: { status } });
    }
    expect(ensurePartReturn({ lineQuantity: 2 })).toBe(2);
    expect(ensurePartReturn({ lineQuantity: 2, quantity: 1 })).toBe(1);
    expect(fail(() => ensurePartReturn({ lineQuantity: 2, quantity: 3 }))).toEqual({
      code: 'PART_RETURN_EXCEEDS',
      details: { used: 2 },
    });
  });

  it('przyjęcie dostawy i korekta stanu z powodem', () => {
    expect(() => ensurePartReceipt({ quantity: 20, unitCost: 2400 })).not.toThrow();
    expect(() => ensurePartReceipt({ quantity: 20, unitCost: null })).not.toThrow();
    expect(fail(() => ensurePartReceipt({ quantity: 1.5, unitCost: null }))?.details).toEqual({ field: 'quantity' });
    expect(fail(() => ensurePartReceipt({ quantity: 1, unitCost: -1 }))?.details).toEqual({ field: 'unitCost' });
    const adjust = { stockQty: 3, newQty: 0, reason: 'STOCKTAKE', note: null } as const;
    expect(() => ensureStockAdjustment(adjust)).not.toThrow();
    expect(fail(() => ensureStockAdjustment({ ...adjust, newQty: -1 }))?.details).toEqual({ field: 'newQty' });
    expect(fail(() => ensureStockAdjustment({ ...adjust, newQty: 3 }))?.code).toBe('PART_ADJUST_NO_CHANGE');
    expect(fail(() => ensureStockAdjustment({ ...adjust, reason: 'OTHER', note: ' ' }))?.details).toEqual({
      field: 'note',
    });
    expect(() => ensureStockAdjustment({ ...adjust, reason: 'OTHER', note: 'Pomyłka przy przyjęciu' })).not.toThrow();
  });

  it('koszt części z kosztu z chwili użycia i stan poniżej minimum jak widok bazy', () => {
    expect(
      partsCost([
        { quantity: 1, unitCost: 2400 },
        { quantity: 1, unitCost: 1250 },
      ]),
    ).toBe(3650);
    expect(isBelowMinimum({ stockQty: 9, minStockQty: 10 })).toBe(true);
    expect(isBelowMinimum({ stockQty: 10, minStockQty: 10 })).toBe(false);
    expect(isBelowMinimum({ stockQty: 22, minStockQty: 10 })).toBe(false);
  });
});

describe('stan hulajnogi: serwis i powrót do floty', () => {
  const ready = { openUrgentTickets: 0, openTasks: 0, online: true, batteryPct: 15, minBatteryPct: 15 };

  it('przeszkody w powrocie w kolejności funkcji SQL', () => {
    expect(returnToFleetBlockers(ready)).toEqual([]);
    expect(
      returnToFleetBlockers({ openUrgentTickets: 1, openTasks: 1, online: false, batteryPct: 14, minBatteryPct: 15 }),
    ).toEqual(['URGENT_TICKET', 'OPEN_TASKS', 'OFFLINE', 'BATTERY_BELOW_THRESHOLD']);
    expect(returnToFleetBlockers({ ...ready, batteryPct: null })).toEqual(['BATTERY_BELOW_THRESHOLD']);
    // Otwarte pilne zgłoszenie bez zadania też zatrzymuje hulajnogę w serwisie.
    expect(returnToFleetBlockers({ ...ready, openUrgentTickets: 1 })).toEqual(['URGENT_TICKET']);
    expect(statusAfterService(['URGENT_TICKET', 'OFFLINE']).reason).toBe('URGENT_TICKET');
  });

  it('ręczne RESOLVED pilnego zgłoszenia: przyczyna z reguły powrotu, bez przeszkód OTHER', () => {
    expect(reasonAfterUrgentTicketResolved([])).toBe('OTHER');
    expect(reasonAfterUrgentTicketResolved(['URGENT_TICKET'])).toBe('URGENT_TICKET');
    expect(reasonAfterUrgentTicketResolved(['OPEN_TASKS', 'OFFLINE'])).toBe('SERVICE_TASK');
    expect(reasonAfterUrgentTicketResolved(['BATTERY_BELOW_THRESHOLD'])).toBe('BATTERY_BELOW_THRESHOLD');
  });

  it('formularz floty: powrót według reguły, serwis i wycofanie z przyczyną zgodną ze stanem', () => {
    const base = {
      from: 'MAINTENANCE',
      to: 'AVAILABLE',
      hasOpenRental: false,
      openTasks: 0,
      blockers: [],
      serviceHold: null,
    } as const;
    expect(fleetFormStatusChange({ ...base, to: 'MAINTENANCE' })).toBeNull();
    expect(fleetFormStatusChange(base)).toEqual({ status: 'AVAILABLE', reason: null });
    expect(fail(() => fleetFormStatusChange({ ...base, blockers: ['OPEN_TASKS'], openTasks: 1 }))).toEqual({
      code: 'RETURN_TO_FLEET_BLOCKED',
      details: { blockers: ['OPEN_TASKS'] },
    });
    // Wycofana (np. kradzież) wraca tylko do serwisu, z przyczyną dozwoloną w MAINTENANCE.
    expect(fleetFormStatusChange({ ...base, from: 'RETIRED', to: 'MAINTENANCE' })).toEqual({
      status: 'MAINTENANCE',
      reason: 'OTHER',
    });
    expect(fail(() => fleetFormStatusChange({ ...base, from: 'RETIRED' }))?.code).toBe('SCOOTER_RETIRED');
    expect(
      fleetFormStatusChange({ ...base, from: 'AVAILABLE', to: 'MAINTENANCE', serviceHold: 'SERVICE_TASK' }),
    ).toEqual({
      status: 'MAINTENANCE',
      reason: 'SERVICE_TASK',
    });
    // Wycofanie (także „usunięcie”) jak „Wyłącz z ruchu”: nie przy otwartych zadaniach.
    expect(fleetFormStatusChange({ ...base, to: 'RETIRED' })).toEqual({ status: 'RETIRED', reason: 'OTHER' });
    expect(fail(() => fleetFormStatusChange({ ...base, to: 'RETIRED', openTasks: 1 }))?.code).toBe(
      'SCOOTER_HAS_OPEN_TASKS',
    );
    expect(
      fail(() => fleetFormStatusChange({ ...base, from: 'IN_USE', to: 'RETIRED', hasOpenRental: true }))?.code,
    ).toBe('SCOOTER_HAS_OPEN_RENTAL');
  });

  it('po ostatnim zadaniu wraca do floty albo zostaje w serwisie z przyczyną', () => {
    expect(statusAfterService([])).toEqual({ status: 'AVAILABLE', reason: null });
    expect(statusAfterService(['BATTERY_BELOW_THRESHOLD'])).toEqual({
      status: 'MAINTENANCE',
      reason: 'BATTERY_BELOW_THRESHOLD',
    });
    expect(statusAfterService(['OFFLINE', 'BATTERY_BELOW_THRESHOLD']).reason).toBe('OFFLINE');
    expect(() => ensureCanReturnToFleet('MAINTENANCE', [])).not.toThrow();
    expect(fail(() => ensureCanReturnToFleet('MAINTENANCE', ['OFFLINE']))).toEqual({
      code: 'RETURN_TO_FLEET_BLOCKED',
      details: { blockers: ['OFFLINE'] },
    });
    expect(fail(() => ensureCanReturnToFleet('AVAILABLE', []))?.code).toBe('SCOOTER_NOT_IN_MAINTENANCE');
  });

  it('wyłączenie do serwisu: wolna od razu, w przejeździe po jego zakończeniu', () => {
    expect(maintenanceEffect('AVAILABLE', 'URGENT_TICKET')).toEqual({ kind: 'NOW', reason: 'URGENT_TICKET' });
    expect(maintenanceEffect('IN_USE', 'SERVICE_TASK')).toEqual({ kind: 'AFTER_RENTAL' });
    expect(maintenanceEffect('RESERVED', 'SERVICE_TASK')).toEqual({ kind: 'AFTER_RENTAL' });
    expect(maintenanceEffect('MAINTENANCE', 'SERVICE_TASK')).toEqual({ kind: 'NONE' });
    expect(scooterStatusAfterRental({ openUrgentTickets: 1, openTasks: 1 })).toEqual({
      status: 'MAINTENANCE',
      reason: 'URGENT_TICKET',
    });
    expect(scooterStatusAfterRental({ openUrgentTickets: 0, openTasks: 1 }).reason).toBe('SERVICE_TASK');
    expect(scooterStatusAfterRental({ openUrgentTickets: 0, openTasks: 0 }).status).toBe('AVAILABLE');
  });

  it('„Wyłącz z ruchu” niedostępne w przejeździe i przy otwartych zadaniach', () => {
    const base = { status: 'AVAILABLE', hasOpenRental: false, openTasks: 0, reason: 'THEFT', note: null } as const;
    expect(() => ensureCanRetire(base)).not.toThrow();
    expect(fail(() => ensureCanRetire({ ...base, hasOpenRental: true }))?.code).toBe('SCOOTER_HAS_OPEN_RENTAL');
    expect(fail(() => ensureCanRetire({ ...base, openTasks: 1 }))?.code).toBe('SCOOTER_HAS_OPEN_TASKS');
    expect(fail(() => ensureCanRetire({ ...base, status: 'RETIRED' }))?.code).toBe('SCOOTER_RETIRED');
    expect(fail(() => ensureCanRetire({ ...base, reason: 'OTHER' }))?.details).toEqual({ field: 'note' });
  });
});
