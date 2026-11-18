import * as core from '@hulajnogi/core';
import * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOBS } from '../src/jobs/jobs.service.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

describe('wyliczenia zgłoszeń i serwisu w kontrakcie API są zgodne z packages/core', () => {
  it.each([
    ['TICKET_SOURCES', shared.TICKET_SOURCES, core.TICKET_SOURCES],
    ['TICKET_STATUSES', shared.TICKET_STATUSES, core.TICKET_STATUSES],
    ['MANUAL_TICKET_STATUSES', shared.MANUAL_TICKET_STATUSES, core.MANUAL_TICKET_STATUSES],
    ['TICKET_CATEGORIES', shared.TICKET_CATEGORIES, core.TICKET_CATEGORIES],
    ['CUSTOMER_TICKET_CATEGORIES', shared.CUSTOMER_TICKET_CATEGORIES, core.CUSTOMER_TICKET_CATEGORIES],
    ['URGENT_TICKET_CATEGORIES', shared.URGENT_TICKET_CATEGORIES, core.URGENT_TICKET_CATEGORIES],
    ['DESCRIPTION_REQUIRED_CATEGORIES', shared.DESCRIPTION_REQUIRED_CATEGORIES, core.DESCRIPTION_REQUIRED_CATEGORIES],
    ['AUTO_TICKET_KINDS', shared.AUTO_TICKET_KINDS, core.AUTO_TICKET_KINDS],
    ['SERVICE_TASK_TYPES', shared.SERVICE_TASK_TYPES, core.SERVICE_TASK_TYPES],
    ['SERVICE_TASK_STATUSES', shared.SERVICE_TASK_STATUSES, core.SERVICE_TASK_STATUSES],
    ['TASK_PRIORITIES', shared.TASK_PRIORITIES, core.TASK_PRIORITIES],
    ['SCOOTER_STATUS_REASONS', shared.SCOOTER_STATUS_REASONS, core.SCOOTER_STATUS_REASONS],
    ['RETIRE_REASONS', shared.RETIRE_REASONS, core.RETIRE_REASONS],
    ['RETURN_BLOCKERS', shared.RETURN_BLOCKERS, core.RETURN_BLOCKERS],
    ['PART_MOVEMENT_KINDS', shared.PART_MOVEMENT_KINDS, core.PART_MOVEMENT_KINDS],
    ['PART_ADJUST_REASONS', shared.PART_ADJUST_REASONS, core.PART_ADJUST_REASONS],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('limit zdjęć zgłoszenia jest ten sam', () => {
    expect(shared.TICKET_MAX_PHOTOS).toBe(core.TICKET_MAX_PHOTOS);
  });
});

/**
 * Zgłoszenia (ADR 0055): od klienta (pilność i wyłączenie z ruchu, D5), reklamacja ze zwrotem i odpowiedzią (D7),
 * dane klienta tylko z `users.read`, zgłoszenia automatyczne bez duplikatów i ich zamknięcie.
 */
describe.skipIf(!process.env.DATABASE_URL)('API: zgłoszenia', () => {
  let ctx: OperationsContext;
  const customers = {} as Record<'anna' | 'bartek', { id: string; token: string }>;
  const anna = (options: Parameters<ReturnType<OperationsContext['customer']>>[0]) =>
    ctx.customer(customers.anna.token)(options);
  const ticketDetails = async (who: 'dispatcher' | 'technician', id: string) =>
    (await ctx.staff[who]({ method: 'GET', url: `/admin/tickets/${id}` })).json<shared.TicketAdminDetails>();

  beforeAll(async () => {
    ctx = await operationsContext('tickets_api', 8);
    customers.anna = await ctx.register('+48500300100', 'Anna Zgłaszająca');
    customers.bartek = await ctx.register('+48500300200', 'Bartek');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('pilne zgłoszenie z karty wolnej hulajnogi: MAINTENANCE od razu, wpis systemu, Moje zgłoszenia', async () => {
    const scooterId = await ctx.idOf(3);
    const photoId = await ctx.photo({ userId: customers.anna.id });
    const res = await anna({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId, categories: ['BRAKES', 'LIGHTS'], description: 'Hamulec nie działa', photoIds: [photoId] },
    });
    expect(res.statusCode).toBe(201);
    const ticket = res.json<shared.CustomerTicketView>();
    expect(ticket).toMatchObject({
      status: 'NEW',
      categories: ['BRAKES', 'LIGHTS'],
      scooterNumber: 3,
      rental: null,
      reply: null,
      hasUnreadReply: false,
      history: [{ status: 'NEW' }],
    });
    expect(ticket.photos).toEqual([expect.objectContaining({ id: photoId, url: expect.stringContaining(photoId) })]);
    expect(shared.ticketLabel(ticket.number)).toMatch(/^Z-\d{4,}$/);

    expect(await ctx.scooterRow(3)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });
    expect(await ctx.auditOf(scooterId, 'scooter.sent_to_service')).toEqual([
      expect.objectContaining({
        actor: 'SYSTEM',
        staff_id: null,
        data: expect.objectContaining({ ticketId: ticket.id }),
      }),
    ]);
    const mine = (await anna({ method: 'GET', url: '/me/tickets' })).json<shared.CustomerTicketListItem[]>();
    expect(mine.map((t) => t.id)).toContain(ticket.id);
    // Cudze zgłoszenie jak nieistniejące.
    const foreign = await ctx.customer(customers.bartek.token)({ method: 'GET', url: `/me/tickets/${ticket.id}` });
    expect(foreign.statusCode).toBe(404);
    // Zdjęcie przypięte raz: drugie zgłoszenie z tym samym plikiem dostaje FILE_ALREADY_ATTACHED.
    const again = await anna({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(5), categories: ['LIGHTS'], photoIds: [photoId] },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('FILE_ALREADY_ATTACHED');
  });

  it('walidacja: rozliczenie bez przejazdu, opis przy OTHER, kategoria systemowa, cudze zdjęcie', async () => {
    const scooterId = await ctx.idOf(5);
    const post = (payload: object) => anna({ method: 'POST', url: '/tickets', payload: { scooterId, ...payload } });
    const billing = await post({ categories: ['BILLING'], description: 'Za drogo' });
    expect(billing.statusCode).toBe(422);
    expect(billing.json().code).toBe('TICKET_RENTAL_REQUIRED');
    const other = await post({ categories: ['OTHER'] });
    expect(other.statusCode).toBe(400);
    expect(other.json().code).toBe('TICKET_DESCRIPTION_REQUIRED');
    expect((await post({ categories: ['CONNECTION'] })).json().code).toBe('VALIDATION_ERROR');
    const foreign = await post({
      categories: ['LIGHTS'],
      photoIds: [await ctx.photo({ userId: customers.bartek.id })],
    });
    expect(foreign.statusCode).toBe(404);
    expect(await ctx.scooterRow(5)).toMatchObject({ status: 'AVAILABLE' });
  });

  it('zgłoszenie w trakcie przejazdu nie kończy go (D5); po zakończeniu hulajnoga przechodzi do MAINTENANCE', async () => {
    const rentalId = await ctx.ride(customers.anna.token, 1);
    const res = await anna({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(1), rentalId, categories: ['WHEEL'], description: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<shared.CustomerTicketView>().rental).toMatchObject({ id: rentalId, endedAt: null });
    const current = (await anna({ method: 'GET', url: '/rentals/current' })).json<{ rental: shared.RentalView }>();
    expect(current.rental).toMatchObject({ id: rentalId, state: 'ACTIVE' });
    expect(await ctx.scooterRow(1)).toMatchObject({ status: 'IN_USE' });

    await ctx.endRide(customers.anna.token, 1);
    expect(await ctx.scooterRow(1)).toMatchObject({ status: 'MAINTENANCE', status_reason: 'URGENT_TICKET' });
    const audit = await ctx.auditOf(await ctx.idOf(1), 'scooter.sent_to_service');
    expect(audit).toEqual([expect.objectContaining({ actor: 'SYSTEM', data: expect.objectContaining({ rentalId }) })]);
  });

  it('reklamacja: Serwisant bez danych klienta i bez zwrotu, Dyspozytor zwraca z ticketId i odpowiada', async () => {
    const rentalId = await ctx.ride(customers.anna.token, 7);
    await ctx.endRide(customers.anna.token, 7);
    const created = await anna({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(7), rentalId, categories: ['BILLING'], description: 'Naliczono za dużo' },
    });
    expect(created.statusCode).toBe(201);
    const ticketId = created.json<shared.CustomerTicketView>().id;
    // Reklamacja nie wyłącza hulajnogi z ruchu.
    expect(await ctx.scooterRow(7)).toMatchObject({ status: 'AVAILABLE' });

    const list = (who: 'dispatcher' | 'technician', query = '') =>
      ctx.staff[who]({ method: 'GET', url: `/admin/tickets?categories=BILLING${query}` });
    const forDispatcher = (await list('dispatcher')).json<shared.ListResponse<shared.TicketListItem>>();
    expect(forDispatcher.items.find((t) => t.id === ticketId)).toMatchObject({
      reporterName: 'Anna Zgłaszająca',
      rentalId,
      categories: ['BILLING'],
    });
    const forTechnician = (await list('technician')).json<shared.ListResponse<shared.TicketListItem>>();
    expect(forTechnician.items.find((t) => t.id === ticketId)).toMatchObject({
      reporterName: null,
      reporterPhone: null,
    });
    expect((await list('technician', '&reporterPhone.contains=500')).statusCode).toBe(403);
    const search = await ctx.staff.technician({ method: 'GET', url: '/admin/tickets?q=Anna' });
    expect(search.json<shared.ListResponse<shared.TicketListItem>>().total).toBe(0);
    expect((await ticketDetails('technician', ticketId)).reporter).toEqual({ id: customers.anna.id, name: null });
    expect((await ticketDetails('dispatcher', ticketId)).reporter).toEqual({
      id: customers.anna.id,
      name: 'Anna Zgłaszająca',
    });

    const refund = (who: 'dispatcher' | 'technician', payload: object) =>
      ctx.staff[who]({ method: 'POST', url: `/admin/rentals/${rentalId}/refund`, payload });
    expect((await refund('technician', { amount: 100, reason: 'CUSTOMER_COMPLAINT', ticketId })).statusCode).toBe(403);
    const otherRental = await ctx.ride(customers.anna.token, 5);
    await ctx.endRide(customers.anna.token, 5);
    const mismatch = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/rentals/${otherRental}/refund`,
      payload: { amount: 100, reason: 'CUSTOMER_COMPLAINT', ticketId },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().code).toBe('TICKET_RENTAL_MISMATCH');
    expect((await refund('dispatcher', { amount: 100, reason: 'CUSTOMER_COMPLAINT', ticketId })).statusCode).toBe(201);
    const { rows } = await ctx.pool.query(`SELECT ticket_id FROM refunds WHERE rental_id = $1`, [rentalId]);
    expect(rows).toEqual([{ ticket_id: ticketId }]);

    let details = await ticketDetails('dispatcher', ticketId);
    expect(details.refundedAmount).toBe(100);
    expect(details.timeline.map((e) => e.action)).toEqual(
      expect.arrayContaining(['ticket.created', 'rental.refunded', 'refund.succeeded']),
    );
    // Serwisant bez `payments.read` nie widzi zwrotów: ani kwoty, ani wpisów osi czasu, ani sortowania po kwocie.
    const forService = await ticketDetails('technician', ticketId);
    expect(forService.refundedAmount).toBeNull();
    expect(forService.timeline.map((e) => e.entityType)).not.toContain('refund');
    expect(forService.timeline.map((e) => e.action)).not.toContain('rental.refunded');
    const serviceList = (await list('technician')).json<shared.ListResponse<shared.TicketListItem>>();
    expect(serviceList.items.find((t) => t.id === ticketId)?.refundedAmount).toBeNull();
    const sorted = await list('technician', '&sort=-refundedAmount');
    expect(sorted.statusCode).toBe(403);
    expect(sorted.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'payments.read' } });
    expect(details.suggestedTaskType).toBeNull();

    // RESOLVED zgłoszenia klienta wymaga odpowiedzi; odpowiedź idzie do klienta (D7).
    const resolve = (payload: object) =>
      ctx.staff.dispatcher({ method: 'POST', url: `/admin/tickets/${ticketId}/status`, payload });
    const noReply = await resolve({ version: details.version, status: 'RESOLVED' });
    expect(noReply.statusCode).toBe(422);
    expect(noReply.json().code).toBe('TICKET_REPLY_REQUIRED');
    const stale = await resolve({ version: details.version + 5, status: 'IN_PROGRESS' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('CONFLICT');
    const resolved = await resolve({
      version: details.version,
      status: 'RESOLVED',
      reply: 'Zwróciliśmy 1 zł na portfel.',
      note: 'Zwrot dobrej woli',
    });
    expect(resolved.statusCode).toBe(201);
    details = resolved.json<shared.TicketAdminDetails>();
    expect(details).toMatchObject({
      status: 'RESOLVED',
      resolutionNote: 'Zwrot dobrej woli',
      reply: { text: 'Zwróciliśmy 1 zł na portfel.', readAt: null },
      resolvedAt: expect.any(String),
    });
    const closed = await resolve({ version: details.version, status: 'IN_PROGRESS' });
    expect(closed.json().code).toBe('TICKET_RESOLVED');

    const unread = (await anna({ method: 'GET', url: '/me/tickets' })).json<shared.CustomerTicketListItem[]>();
    expect(unread.find((t) => t.id === ticketId)?.hasUnreadReply).toBe(true);
    const view = (await anna({ method: 'GET', url: `/me/tickets/${ticketId}` })).json<shared.CustomerTicketView>();
    expect(view.reply).toMatchObject({ text: 'Zwróciliśmy 1 zł na portfel.', readAt: expect.any(String) });
    expect(view.history.map((h) => h.status)).toEqual(['NEW', 'RESOLVED']);
    expect(view.refund).toMatchObject({ amount: 100 });
    expect(JSON.stringify(view)).not.toContain('Dyspozytor');
    const read = (await anna({ method: 'GET', url: '/me/tickets' })).json<shared.CustomerTicketListItem[]>();
    expect(read.find((t) => t.id === ticketId)?.hasUnreadReply).toBe(false);
  });

  it('zgłoszenie operatora z kategorią systemową, przypisanie i zdjęcie; Serwisant nie zmienia przejazdów', async () => {
    const photoId = await ctx.photo({ staffId: ctx.staffIds.dispatcher });
    const res = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/tickets',
      payload: {
        scooterId: await ctx.idOf(8),
        categories: ['OUT_OF_ZONE'],
        description: 'Stoi na trawniku',
        photoIds: [photoId],
      },
    });
    expect(res.statusCode).toBe(201);
    let ticket = res.json<shared.TicketAdminDetails>();
    expect(ticket).toMatchObject({ source: 'STAFF', urgent: false, reporter: null, suggestedTaskType: 'RELOCATION' });
    expect(ticket.photos).toHaveLength(1);
    expect(await ctx.auditOf(ticket.id, 'ticket.created')).toEqual([
      expect.objectContaining({ actor: 'STAFF', staff_id: ctx.staffIds.dispatcher }),
    ]);

    const assign = await ctx.staff.dispatcher({
      method: 'POST',
      url: `/admin/tickets/${ticket.id}/assign`,
      payload: { version: ticket.version, assigneeId: ctx.staffIds.technician },
    });
    ticket = assign.json<shared.TicketAdminDetails>();
    expect(ticket.assignee).toEqual({ id: ctx.staffIds.technician, name: 'Serwisant Testowy' });
    const removed = await ctx.staff.technician({
      method: 'DELETE',
      url: `/admin/tickets/${ticket.id}/photos/${photoId}`,
    });
    expect(removed.json<shared.TicketAdminDetails>().photos).toEqual([]);
    expect(ticket.timeline.map((e) => e.action)).toEqual(['ticket.created', 'ticket.assigned']);
  });

  it('OFFLINE: sprawdzenie po 5 min bez duplikatów, zamknięcie po powrocie łączności, nowe przy kolejnej utracie', async () => {
    const scooterId = await ctx.idOf(4);
    const offlineTickets = async () =>
      (
        await ctx.pool.query<{ id: string; status: string }>(
          `SELECT id, status::text FROM tickets WHERE scooter_id = $1 AND auto_kind = 'OFFLINE' ORDER BY created_at`,
          [scooterId],
        )
      ).rows;
    const sent = () =>
      ctx.jobs().sent.filter((j) => j.name === JOBS.ticketsOfflineCheck && j.data.scooterId === scooterId);

    await ctx.status(4, false);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ singletonKey: scooterId });
    // Powtórzony status offline (np. po restarcie API) nie planuje drugiego sprawdzenia.
    await ctx.status(4, false);
    expect(sent()).toHaveLength(1);
    // Za wcześnie: sprawdzenie przechodzi na nowy termin, zgłoszenia nie ma.
    await ctx.jobs().run(JOBS.ticketsOfflineCheck, sent()[0]!.data);
    expect(await offlineTickets()).toEqual([]);
    expect(sent()).toHaveLength(2);

    await ctx.pool.query(`UPDATE scooters SET last_seen_at = now() - interval '6 minutes' WHERE id = $1`, [scooterId]);
    const lostAt = new Date(Date.now() - 6 * 60_000).toISOString();
    await ctx.jobs().run(JOBS.ticketsOfflineCheck, { scooterId, lostAt });
    await ctx.jobs().run(JOBS.ticketsOfflineCheck, { scooterId, lostAt });
    const [opened] = await offlineTickets();
    expect(await offlineTickets()).toHaveLength(1);
    expect(opened).toMatchObject({ status: 'NEW' });
    expect(await ctx.auditOf(opened!.id, 'ticket.created')).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', data: expect.objectContaining({ autoKind: 'OFFLINE' }) }),
    ]);
    // Brak łączności nie wyłącza hulajnogi z ruchu (zgłoszenie niepilne, bez zadania).
    expect(await ctx.scooterRow(4)).toMatchObject({ status: 'AVAILABLE' });

    await ctx.status(4, true);
    expect(await offlineTickets()).toEqual([{ id: opened!.id, status: 'RESOLVED' }]);
    expect(await ctx.auditOf(opened!.id, 'ticket.auto_closed')).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', data: expect.objectContaining({ reason: 'CONNECTION_RESTORED' }) }),
    ]);

    await ctx.status(4, false);
    await ctx.pool.query(`UPDATE scooters SET last_seen_at = now() - interval '6 minutes' WHERE id = $1`, [scooterId]);
    await ctx
      .jobs()
      .run(JOBS.ticketsOfflineCheck, { scooterId, lostAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    expect((await offlineTickets()).map((t) => t.status)).toEqual(['RESOLVED', 'NEW']);
    await ctx.status(4, true);
  });

  it('OFFLINE z zadaniem albo w serwisie nie zamyka się samo', async () => {
    const scooterId = await ctx.idOf(6);
    await ctx.status(6, false);
    await ctx.pool.query(`UPDATE scooters SET last_seen_at = now() - interval '6 minutes' WHERE id = $1`, [scooterId]);
    await ctx
      .jobs()
      .run(JOBS.ticketsOfflineCheck, { scooterId, lostAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    const { rows } = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM tickets WHERE scooter_id = $1 AND auto_kind = 'OFFLINE' AND status <> 'RESOLVED'`,
      [scooterId],
    );
    const ticket = await ticketDetails('dispatcher', rows[0]!.id);
    const task = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: { scooterId, type: 'INSPECTION', ticketId: ticket.id },
    });
    expect(task.statusCode).toBe(201);
    await ctx.status(6, true);
    expect((await ticketDetails('dispatcher', ticket.id)).status).toBe('AT_SERVICE');
  });

  it('zdjęcia: powtórzone i równoległe przypięcie pliku, zdjęcie operatora tylko w panelu, ticket.updated klienta bez operatora', async () => {
    const bartek = ctx.customer(customers.bartek.token);
    const create = async (number: number, photoIds: string[]) =>
      bartek({
        method: 'POST',
        url: '/tickets',
        payload: { scooterId: await ctx.idOf(number), categories: ['LIGHTS'], photoIds },
      });
    const photoId = await ctx.photo({ userId: customers.bartek.id });
    const duplicated = await create(2, [photoId, photoId]);
    expect(duplicated.statusCode).toBe(400);
    expect(duplicated.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'photoIds' } });

    // Dwa zgłoszenia naraz z tym samym zdjęciem (różne hulajnogi, więc bez wspólnej blokady hulajnogi): jedno
    // przypina plik, drugie dostaje FILE_ALREADY_ATTACHED zamiast drugiego przypięcia.
    const results = await Promise.all([create(2, [photoId]), create(6, [photoId])]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('FILE_ALREADY_ATTACHED');
    const { rows } = await ctx.pool.query(`SELECT ticket_id FROM ticket_photos WHERE file_id = $1`, [photoId]);
    expect(rows).toHaveLength(1);
    const ticketId = results.find((r) => r.statusCode === 201)!.json<shared.CustomerTicketView>().id;

    // Zdjęcie operatora jest w panelu, a klient widzi tylko własne; zdarzenie dla klienta nie ma przypisanego.
    const gateway = ctx.app.get(FleetGateway) as unknown as { server?: unknown };
    const original = gateway.server;
    const emitted: Array<{ room: string; event: string; payload: Record<string, unknown> }> = [];
    gateway.server = {
      to: (room: string) => ({
        emit: (event: string, payload: Record<string, unknown>) => emitted.push({ room, event, payload }),
      }),
    };
    try {
      const staffPhoto = await ctx.photo({ staffId: ctx.staffIds.dispatcher });
      const added = await ctx.staff.dispatcher({
        method: 'POST',
        url: `/admin/tickets/${ticketId}/photos`,
        payload: { fileId: staffPhoto },
      });
      expect(added.json<shared.TicketAdminDetails>().photos).toHaveLength(2);
    } finally {
      gateway.server = original;
    }
    const updates = emitted.filter((e) => e.event === 'ticket.updated');
    expect(updates.find((e) => e.room === 'tickets')?.payload).toHaveProperty('assigneeId');
    const forCustomer = updates.find((e) => e.room === shared.userRoom(customers.bartek.id));
    expect(forCustomer?.payload).toMatchObject({ id: ticketId });
    expect(forCustomer?.payload).not.toHaveProperty('assigneeId');
    const view = (await bartek({ method: 'GET', url: `/me/tickets/${ticketId}` })).json<shared.CustomerTicketView>();
    expect(view.photos.map((p) => p.id)).toEqual([photoId]);
  });
});
