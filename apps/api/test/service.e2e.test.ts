import * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

/**
 * Proces serwisowy (ADR 0055, scenariusz demo iteracji 6): zgłoszenie pilne → MAINTENANCE → zadanie → części →
 * zakończenie → powrót do floty albo serwis z przyczyną; magazyn, wyłączenie z ruchu, zgłoszenia automatyczne
 * przy zakończeniu przejazdu, pulpit i pliki.
 */
describe.skipIf(!process.env.DATABASE_URL)('API: serwis, magazyn i pulpit', () => {
  let ctx: OperationsContext;
  let anna: { id: string; token: string };
  const partId = async (sku: string) =>
    (await ctx.pool.query<{ id: string }>('SELECT id FROM spare_parts WHERE sku = $1', [sku])).rows[0]!.id;
  const stock = async (sku: string) =>
    (await ctx.pool.query<{ stock_qty: number }>('SELECT stock_qty FROM spare_parts WHERE sku = $1', [sku])).rows[0]!
      .stock_qty;
  const task = async (id: string) =>
    (
      await ctx.staff.technician({ method: 'GET', url: `/admin/service-tasks/${id}` })
    ).json<shared.ServiceTaskDetails>();
  const command = (id: string, action: string, payload: object) =>
    ctx.staff.technician({ method: 'POST', url: `/admin/service-tasks/${id}/${action}`, payload });
  const urgentTicket = async (number: number) => {
    const res = await ctx.customer(anna.token)({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(number), categories: ['BRAKES'], description: 'Nie hamuje' },
    });
    expect(res.statusCode).toBe(201);
    return res.json<shared.CustomerTicketView>().id;
  };

  beforeAll(async () => {
    ctx = await operationsContext('service_api', 11);
    anna = await ctx.register('+48500400100', 'Anna Serwisowa');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('demo: pilne zgłoszenie → zadanie → części → zakończenie → zgłoszenie RESOLVED, hulajnoga wraca do floty', async () => {
    const ticketId = await urgentTicket(3);
    expect(await ctx.scooterRow(3)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });

    // Dyspozytor (service.manage od migracji 0008) zakłada naprawę ze zgłoszenia dla serwisanta.
    const created = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: {
        scooterId: await ctx.idOf(3),
        ticketId,
        type: 'REPAIR',
        priority: 'HIGH',
        assigneeId: ctx.staffIds.technician,
        description: 'Klocki hamulca',
      },
    });
    expect(created.statusCode).toBe(201);
    let details = created.json<shared.ServiceTaskDetails>();
    expect(details).toMatchObject({
      status: 'OPEN',
      ticket: { id: ticketId, urgent: true },
      assigneeName: 'Serwisant Testowy',
      returnCheck: { blockers: [], openTasks: 0 },
    });
    const ticket = (
      await ctx.staff.technician({ method: 'GET', url: `/admin/tickets/${ticketId}` })
    ).json<shared.TicketAdminDetails>();
    expect(ticket).toMatchObject({ status: 'AT_SERVICE', tasks: [{ id: details.id }] });
    expect(ticket.availableTaskTypes).not.toContain('REPAIR');
    const duplicate = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: { scooterId: await ctx.idOf(3), type: 'REPAIR' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('SERVICE_TASK_TYPE_OPEN');

    const mine = (await ctx.staff.technician({ method: 'GET', url: '/admin/service-tasks/mine' })).json<
      shared.ListResponse<shared.ServiceTaskListItem>
    >();
    expect(mine.items.map((t) => t.id)).toContain(details.id);

    const pad = await partId('BRK-PAD-R');
    const before = await stock('BRK-PAD-R');
    const early = await command(details.id, 'parts', { partId: pad, quantity: 1 });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('TASK_NOT_IN_PROGRESS');

    details = (await command(details.id, 'start', { version: details.version })).json<shared.ServiceTaskDetails>();
    expect(details).toMatchObject({ status: 'IN_PROGRESS', startedAt: expect.any(String) });
    details = (await command(details.id, 'parts', { partId: pad, quantity: 2 })).json<shared.ServiceTaskDetails>();
    expect(details.parts).toEqual([expect.objectContaining({ partId: pad, quantity: 2 })]);
    expect(await stock('BRK-PAD-R')).toBe(before - 2);
    const tooMany = await command(details.id, 'parts', { partId: pad, quantity: before + 10 });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({ code: 'PART_OUT_OF_STOCK', details: { available: before - 2 } });
    details = (
      await command(details.id, 'parts/remove', { partId: pad, quantity: 1 })
    ).json<shared.ServiceTaskDetails>();
    expect(details.parts[0]).toMatchObject({ quantity: 1 });
    expect(details.partsCost).toBe(details.parts[0]!.unitCost);
    expect(await stock('BRK-PAD-R')).toBe(before - 1);
    const movements = (
      await ctx.staff.technician({ method: 'GET', url: `/admin/spare-part-movements?taskId=${details.id}` })
    ).json<shared.ListResponse<shared.SparePartMovementItem>>();
    expect(movements.items.map((m) => [m.kind, m.delta, m.taskNumber])).toEqual([
      ['RETURN', 1, details.number],
      ['USE', -2, details.number],
    ]);

    expect((await command(details.id, 'complete', { version: details.version, note: ' ' })).statusCode).toBe(400);
    const done = await command(details.id, 'complete', { version: details.version, note: 'Wymieniono klocki' });
    expect(done.statusCode).toBe(201);
    expect(done.json<shared.ServiceTaskDetails>()).toMatchObject({ status: 'DONE', resultNote: 'Wymieniono klocki' });
    expect(await ctx.scooterRow(3)).toMatchObject({ status: 'AVAILABLE', status_reason: null });
    expect(await ctx.auditOf(await ctx.idOf(3), 'scooter.returned_to_fleet')).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', data: expect.objectContaining({ taskId: details.id }) }),
    ]);
    const customerView = (
      await ctx.customer(anna.token)({ method: 'GET', url: `/me/tickets/${ticketId}` })
    ).json<shared.CustomerTicketView>();
    expect(customerView.status).toBe('RESOLVED');
    expect(customerView.history.map((h) => h.status)).toEqual(['NEW', 'AT_SERVICE', 'RESOLVED']);
    const timeline = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/tickets/${ticketId}` })
    ).json<shared.TicketAdminDetails>().timeline;
    expect(timeline.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'ticket.created',
        'service_task.created',
        'service_task.part_added',
        'service_task.completed',
      ]),
    );
    const fleet = (await ctx.staff.dispatcher({ method: 'GET', url: '/admin/scooters?number=3' })).json<
      shared.ListResponse<shared.ScooterListItem>
    >();
    expect(fleet.items[0]).toMatchObject({
      status: 'AVAILABLE',
      statusReason: null,
      statusChangedAt: expect.any(String),
    });
  });

  it('zostaje w serwisie bez łączności; „Przywróć do floty” sprawdza tę samą regułę', async () => {
    const scooterId = await ctx.idOf(5);
    const created = await ctx.staff.technician({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: { scooterId, type: 'INSPECTION' },
    });
    let details = created.json<shared.ServiceTaskDetails>();
    expect(await ctx.scooterRow(5)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'SERVICE_TASK' });
    details = (await command(details.id, 'start', { version: details.version })).json<shared.ServiceTaskDetails>();
    expect(details.assigneeId).toBe(ctx.staffIds.technician);
    await ctx.pool.query(`UPDATE scooters SET online = false WHERE id = $1`, [scooterId]);
    expect((await task(details.id)).returnCheck.blockers).toEqual(['OFFLINE']);
    await command(details.id, 'complete', { version: details.version, note: 'Przegląd bez uwag' });
    expect(await ctx.scooterRow(5)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'OFFLINE' });

    const summary = (
      await ctx.staff.technician({ method: 'GET', url: `/admin/scooters/${scooterId}/service` })
    ).json<shared.ScooterServiceSummary>();
    expect(summary).toMatchObject({ statusReason: 'OFFLINE', returnCheck: { blockers: ['OFFLINE'] }, tasksDone: 1 });
    const blocked = await ctx.staff.technician({
      method: 'POST',
      url: `/admin/scooters/${scooterId}/return-to-fleet`,
      payload: { version: summary.version },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'RETURN_TO_FLEET_BLOCKED', details: { blockers: ['OFFLINE'] } });
    await ctx.pool.query(`UPDATE scooters SET online = true WHERE id = $1`, [scooterId]);
    const returned = await ctx.staff.technician({
      method: 'POST',
      url: `/admin/scooters/${scooterId}/return-to-fleet`,
      payload: { version: summary.version },
    });
    expect(returned.statusCode).toBe(201);
    expect(returned.json<shared.ScooterServiceSummary>()).toMatchObject({ status: 'AVAILABLE', statusReason: null });
    expect(await ctx.auditOf(scooterId, 'scooter.returned_to_fleet')).toEqual([
      expect.objectContaining({ actor: 'STAFF', staff_id: ctx.staffIds.technician }),
    ]);
  });

  it('anulowanie zwraca części na stan i zgłoszenie do dyspozytora; zakończenie wymiany baterii wysyła battery_swapped', async () => {
    const ticketId = await urgentTicket(7);
    const scooterId = await ctx.idOf(7);
    let details = (
      await ctx.staff.dispatcher({
        method: 'POST',
        url: '/admin/service-tasks',
        payload: { scooterId, ticketId, type: 'REPAIR' },
      })
    ).json<shared.ServiceTaskDetails>();
    details = (await command(details.id, 'start', { version: details.version })).json<shared.ServiceTaskDetails>();
    const cable = await partId('BRK-CBL-R');
    const before = await stock('BRK-CBL-R');
    details = (await command(details.id, 'parts', { partId: cable, quantity: 2 })).json<shared.ServiceTaskDetails>();
    expect(await stock('BRK-CBL-R')).toBe(before - 2);
    expect((await command(details.id, 'cancel', { version: details.version, reason: '' })).statusCode).toBe(400);
    const cancelled = await command(details.id, 'cancel', { version: details.version, reason: 'Brak części' });
    expect(cancelled.json<shared.ServiceTaskDetails>()).toMatchObject({ status: 'CANCELLED', parts: [], partsCost: 0 });
    expect(await stock('BRK-CBL-R')).toBe(before);
    const ticket = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/tickets/${ticketId}` })
    ).json<shared.TicketAdminDetails>();
    expect(ticket.status).toBe('IN_PROGRESS');
    // Pilne zgłoszenie nadal otwarte: hulajnoga zostaje w serwisie.
    expect(await ctx.scooterRow(7)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });

    // Wymiana baterii (ADR 0059): API nie zakłada 100%. Po zakończeniu hulajnoga czeka w serwisie na odczyt nowej
    // baterii; odczyt z bufora ani poniżej progu jej nie wypuszcza, odczyt bieżący ponad progiem tak (wpis systemu).
    const battery = await ctx.idOf(9);
    await ctx.pool.query(`UPDATE scooters SET battery_pct = 4 WHERE id = $1`, [battery]);
    let swap = (
      await ctx.staff.technician({
        method: 'POST',
        url: '/admin/service-tasks',
        payload: { scooterId: battery, type: 'BATTERY_SWAP' },
      })
    ).json<shared.ServiceTaskDetails>();
    swap = (await command(swap.id, 'start', { version: swap.version })).json<shared.ServiceTaskDetails>();
    expect(swap.returnCheck.blockers).toEqual(['BATTERY_BELOW_THRESHOLD']);
    await command(swap.id, 'complete', { version: swap.version, note: 'Nowa bateria' });
    expect(ctx.commands(9).at(-1)).toMatchObject({ cmd: 'battery_swapped' });
    expect(await ctx.scooterRow(9)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'BATTERY_BELOW_THRESHOLD' });
    await ctx.telemetry(9, { bat: 100, buffered: true, at: new Date(Date.now() - 1000) });
    await ctx.telemetry(9, { bat: 10 });
    expect(await ctx.scooterRow(9)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'BATTERY_BELOW_THRESHOLD' });
    await ctx.telemetry(9, { bat: 100, at: new Date(Date.now() + 1000) });
    expect(await ctx.scooterRow(9)).toMatchObject({ status: 'AVAILABLE', status_reason: null, battery_pct: 100 });
    expect(await ctx.auditOf(battery, 'scooter.returned_to_fleet')).toEqual([
      expect.objectContaining({
        actor: 'SYSTEM',
        staff_id: null,
        data: expect.objectContaining({ reason: 'BATTERY_RECOVERED' }),
      }),
    ]);
  });

  it('pilne zgłoszenie bez zadania blokuje „Przywróć do floty”; ręczne RESOLVED zmienia przyczynę bez wypuszczenia', async () => {
    const ticketId = await urgentTicket(11);
    const scooterId = await ctx.idOf(11);
    expect(await ctx.scooterRow(11)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });
    const summary = async () =>
      (
        await ctx.staff.dispatcher({ method: 'GET', url: `/admin/scooters/${scooterId}/service` })
      ).json<shared.ScooterServiceSummary>();
    const before = await summary();
    expect(before.returnCheck).toMatchObject({ blockers: ['URGENT_TICKET'], openUrgentTickets: 1, openTasks: 0 });
    const returnToFleet = (version: number) =>
      ctx.staff.dispatcher({
        method: 'POST',
        url: `/admin/scooters/${scooterId}/return-to-fleet`,
        payload: { version },
      });
    const blocked = await returnToFleet(before.version);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'RETURN_TO_FLEET_BLOCKED', details: { blockers: ['URGENT_TICKET'] } });
    // Formularz floty też nie omija reguły.
    const form = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/scooters/${scooterId}`,
      payload: { version: before.version, status: 'AVAILABLE' },
    });
    expect(form.json()).toMatchObject({ code: 'RETURN_TO_FLEET_BLOCKED', details: { blockers: ['URGENT_TICKET'] } });

    // Fałszywy alarm: dyspozytor rozwiązuje zgłoszenie bez zadania. ADR 0055 nie przewiduje tu automatycznego
    // powrotu, więc hulajnoga zostaje w serwisie z przyczyną OTHER, a „Przywróć do floty” już przechodzi.
    const ticket = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/tickets/${ticketId}` })
    ).json<shared.TicketAdminDetails>();
    const resolved = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/tickets/${ticketId}/status`,
      payload: { version: ticket.version, status: 'RESOLVED', reply: 'Sprawdziliśmy hamulce, działają.' },
    });
    expect(resolved.statusCode).toBe(201);
    expect(await ctx.scooterRow(11)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'OTHER' });
    expect(await ctx.auditOf(scooterId, 'scooter.kept_in_service')).toEqual([
      expect.objectContaining({
        actor: 'SYSTEM',
        data: expect.objectContaining({ ticketId, changes: { statusReason: ['URGENT_TICKET', 'OTHER'] } }),
      }),
    ]);
    const after = await summary();
    expect(after.returnCheck.blockers).toEqual([]);
    expect((await returnToFleet(after.version)).statusCode).toBe(201);
    expect(await ctx.scooterRow(11)).toMatchObject({ status: 'AVAILABLE', status_reason: null });
  });

  it('uprawnienia i wyłączenie z ruchu: Serwisant bez scooters.write, retire z powodem, nie przy otwartych zadaniach', async () => {
    const scooterId = await ctx.idOf(10);
    const summary = (
      await ctx.staff.admin({ method: 'GET', url: `/admin/scooters/${scooterId}/service` })
    ).json<shared.ScooterServiceSummary>();
    const retire = (who: 'admin' | 'technician', payload: object) =>
      ctx.staff[who]({ method: 'POST', url: `/admin/scooters/${scooterId}/retire`, payload });
    expect((await retire('technician', { version: summary.version, reason: 'THEFT' })).statusCode).toBe(403);
    const noNote = await retire('admin', { version: summary.version, reason: 'OTHER' });
    expect(noNote.statusCode).toBe(400);
    expect(noNote.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'note' } });

    const open = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: { scooterId, type: 'RELOCATION', target: { point: { lat: 50.0, lon: 18.5 } } },
    });
    expect(open.statusCode).toBe(201);
    const openTask = open.json<shared.ServiceTaskDetails>();
    expect(openTask.target).toEqual({ point: { lat: 50, lon: 18.5 } });
    const current = (await ctx.scooterRow(10)).version;
    const blocked = await retire('admin', { version: current, reason: 'THEFT' });
    expect(blocked.json().code).toBe('SCOOTER_HAS_OPEN_TASKS');
    await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/service-tasks/${openTask.id}/cancel`,
      payload: { version: openTask.version, reason: 'Pomyłka' },
    });
    const retired = await retire('admin', { version: (await ctx.scooterRow(10)).version, reason: 'THEFT' });
    expect(retired.statusCode).toBe(201);
    expect(retired.json<shared.ScooterServiceSummary>()).toMatchObject({
      status: 'RETIRED',
      statusReason: 'THEFT',
      availableTaskTypes: [],
    });
    const noTarget = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: { scooterId: await ctx.idOf(1), type: 'RELOCATION' },
    });
    expect(noTarget.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'target' } });
  });

  it('zgłoszenia automatyczne przy zakończeniu: krytyczna bateria z BATTERY_SWAP, poza strefą z RELOCATION', async () => {
    const rentalId = await ctx.ride(anna.token, 1);
    await ctx.pool.query(`UPDATE scooters SET battery_pct = 8 WHERE number = 1`);
    await ctx.endRide(anna.token, 1);
    const battery = await ctx.pool.query(
      `SELECT t.status::text AS status, t.rental_id, st.type::text AS type, st.status::text AS task_status
       FROM tickets t JOIN service_tasks st ON st.ticket_id = t.id
       WHERE t.scooter_id = $1 AND t.auto_kind = 'BATTERY_CRITICAL'`,
      [await ctx.idOf(1)],
    );
    expect(battery.rows).toEqual([
      { status: 'AT_SERVICE', rental_id: rentalId, type: 'BATTERY_SWAP', task_status: 'OPEN' },
    ]);
    expect(await ctx.scooterRow(1)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'SERVICE_TASK' });

    const outside = await ctx.ride(anna.token, 2);
    const ended = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/rentals/${outside}/end`,
      payload: { reason: 'SCOOTER_NOT_RESPONDING', collectTowingFee: false },
    });
    expect(ended.statusCode).toBe(201);
    const relocation = await ctx.pool.query(
      `SELECT t.status::text AS status, st.type::text AS type, z.code
       FROM tickets t JOIN service_tasks st ON st.ticket_id = t.id JOIN zones z ON z.id = st.target_zone_id
       WHERE t.scooter_id = $1 AND t.auto_kind = 'OUT_OF_ZONE'`,
      [await ctx.idOf(2)],
    );
    expect(relocation.rows).toEqual([{ status: 'AT_SERVICE', type: 'RELOCATION', code: 'P-01' }]);
    expect(await ctx.scooterRow(2)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'SERVICE_TASK' });
    const tasks = (
      await ctx.staff.technician({
        method: 'GET',
        url: `/admin/service-tasks?type=RELOCATION&scooterId=${await ctx.idOf(2)}`,
      })
    ).json<shared.ListResponse<shared.ServiceTaskListItem>>();
    expect(tasks.items).toEqual([
      expect.objectContaining({ targetZoneCode: 'P-01', createdByName: null, ticketCategories: ['OUT_OF_ZONE'] }),
    ]);
  });

  it('magazyn: nowa część ze stanem, przyjęcie, korekta, edycja, archiwizacja i usunięcie', async () => {
    const create = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/spare-parts',
      payload: {
        sku: 'TST-01',
        name: 'Część testowa',
        unitCost: 1500,
        minStockQty: 10,
        initialQty: 5,
        document: 'WZ-1',
      },
    });
    expect(create.statusCode).toBe(201);
    let part = create.json<shared.SparePartDetails>();
    expect(part).toMatchObject({
      stockQty: 5,
      belowMinimum: true,
      movements: [{ kind: 'RECEIPT', delta: 5, document: 'WZ-1' }],
    });
    const duplicate = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/spare-parts',
      payload: { sku: 'TST-01', name: 'Inna', unitCost: 1, minStockQty: 0 },
    });
    expect(duplicate.json()).toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'sku' } });

    const post = (action: string, payload: object) =>
      ctx.staff.dispatcher({ method: 'POST', url: `/admin/spare-parts/${part.id}/${action}`, payload });
    part = (
      await post('receipts', { version: part.version, quantity: 3, unitCost: 1800 })
    ).json<shared.SparePartDetails>();
    expect(part).toMatchObject({ stockQty: 8, unitCost: 1800 });
    part = (
      await post('adjustments', { version: part.version, newQty: 6, reason: 'STOCKTAKE' })
    ).json<shared.SparePartDetails>();
    expect(part.movements[0]).toMatchObject({ kind: 'ADJUSTMENT', delta: -2, stockAfter: 6, reason: 'STOCKTAKE' });
    const same = await post('adjustments', { version: part.version, newQty: 6, reason: 'STOCKTAKE' });
    expect(same.json().code).toBe('PART_ADJUST_NO_CHANGE');
    const other = await post('adjustments', { version: part.version, newQty: 1, reason: 'OTHER' });
    expect(other.statusCode).toBe(400);
    const stale = await post('receipts', { version: part.version - 1, quantity: 1 });
    expect(stale.json().code).toBe('CONFLICT');
    expect(
      (
        await ctx.staff.technician({
          method: 'POST',
          url: `/admin/spare-parts/${part.id}/receipts`,
          payload: { version: part.version, quantity: 1 },
        })
      ).statusCode,
    ).toBe(201);

    const fresh = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/spare-parts/${part.id}` })
    ).json<shared.SparePartDetails>();
    const updated = await ctx.staff.dispatcher({
      method: 'PATCH',
      url: `/admin/spare-parts/${part.id}`,
      payload: { version: fresh.version, name: 'Część testowa v2', minStockQty: 2 },
    });
    expect(updated.json<shared.SparePartDetails>()).toMatchObject({ name: 'Część testowa v2', belowMinimum: false });
    const archived = await ctx.staff.dispatcher({
      method: 'DELETE',
      url: `/admin/spare-parts/${part.id}?version=${updated.json<shared.SparePartDetails>().version}`,
    });
    expect(archived.json()).toEqual({ outcome: 'ARCHIVED' });
    const inactive = await ctx.staff.dispatcher({ method: 'GET', url: `/admin/spare-parts?active=false&q=TST-01` });
    expect(inactive.json<shared.ListResponse<shared.SparePartListItem>>().items).toHaveLength(1);

    const empty = (
      await ctx.staff.dispatcher({
        method: 'POST',
        url: '/admin/spare-parts',
        payload: { sku: 'TST-02', name: 'Bez ruchów', unitCost: 100, minStockQty: 0 },
      })
    ).json<shared.SparePartDetails>();
    const deleted = await ctx.staff.dispatcher({
      method: 'DELETE',
      url: `/admin/spare-parts/${empty.id}?version=${empty.version}`,
    });
    expect(deleted.json()).toEqual({ outcome: 'DELETED' });
    expect(await ctx.auditOf(part.id, 'spare_part.adjusted')).toHaveLength(1);
  });

  it('pulpit „Wymaga uwagi”: grupy według uprawnień list docelowych, bez nazwisk bez users.read', async () => {
    await urgentTicket(8);
    const forDispatcher = (
      await ctx.staff.dispatcher({ method: 'GET', url: '/admin/dashboard/attention' })
    ).json<shared.DashboardAttention>();
    expect(forDispatcher.criticalBatteryPct).toBe(10);
    expect(forDispatcher.urgentTickets!.count).toBeGreaterThanOrEqual(1);
    expect(forDispatcher.urgentTickets!.items.length).toBeLessThanOrEqual(shared.DASHBOARD_GROUP_ITEMS);
    expect(forDispatcher.urgentTickets!.items.find((t) => t.scooterNumber === 8)).toMatchObject({
      reporterName: 'Anna Serwisowa',
      categories: ['BRAKES'],
    });
    expect(forDispatcher.offlineInRental).toMatchObject({ count: 0, items: [] });
    expect(forDispatcher.failedPayments).toMatchObject({ count: 0, unpaidRentals: 0 });

    const forTechnician = (
      await ctx.staff.technician({ method: 'GET', url: '/admin/dashboard/attention' })
    ).json<shared.DashboardAttention>();
    expect(forTechnician.offlineInRental).toBeNull();
    expect(forTechnician.failedPayments).toBeNull();
    expect(forTechnician.urgentTickets!.items.find((t) => t.scooterNumber === 8)?.reporterName).toBeNull();
    expect(forTechnician.criticalBattery).not.toBeNull();
  });

  it('pliki: lista zawężona do celów z uprawnieniem, usunięcie tylko nieprzypiętego pliku', async () => {
    const photoId = await ctx.photo({ userId: anna.id });
    const loose = await ctx.photo({ staffId: ctx.staffIds.technician });
    await ctx.customer(anna.token)({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(4), categories: ['LIGHTS'], photoIds: [photoId] },
    });
    const list = (who: 'dispatcher' | 'technician') =>
      ctx.staff[who]({ method: 'GET', url: '/admin/files?facets=purpose,attached' });
    const forDispatcher = (await list('dispatcher')).json<shared.ListResponse<shared.FileListItem>>();
    expect(forDispatcher.items.find((f) => f.id === photoId)).toMatchObject({
      attached: true,
      uploadedByName: 'Anna Serwisowa',
      url: expect.stringContaining(photoId),
    });
    const forTechnician = (await list('technician')).json<shared.ListResponse<shared.FileListItem>>();
    expect(forTechnician.items.every((f) => f.purpose === 'TICKET_PHOTO')).toBe(true);
    expect(forTechnician.items.find((f) => f.id === photoId)?.uploadedByName).toBeNull();

    const attached = await ctx.staff.technician({ method: 'DELETE', url: `/admin/files/${photoId}` });
    expect(attached.statusCode).toBe(409);
    expect(attached.json().code).toBe('FILE_ATTACHED');
    expect((await ctx.staff.technician({ method: 'DELETE', url: `/admin/files/${loose}` })).statusCode).toBe(204);
    const { rows } = await ctx.pool.query(`SELECT status::text FROM files WHERE id = $1`, [loose]);
    expect(rows).toEqual([{ status: 'DELETED' }]);
  });
});
