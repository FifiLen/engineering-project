import {
  FLEET_ROOM,
  RENTALS_ROOM,
  SERVICE_ROOM,
  SIMULATOR_ROOM,
  staffRoom,
  TICKETS_ROOM,
  userRoom,
  type ClientToServerEvents,
  type CommandView,
  type ContentUpdated,
  type DataExportReady,
  type DocumentReady,
  type FleetMapScooter,
  type NotificationView,
  type RentalListItem,
  type RentalView,
  type ServerToClientEvents,
  type ServiceTaskUpdated,
  type SimulatorResult,
  type SimulatorStatusView,
  type SubscribeAck,
  type TicketUpdated,
  type WalletSummary,
} from '@hulajnogi/shared';
import type { Permission } from '@hulajnogi/core';
import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JWT } from '../auth/auth.tokens.js';
import type { JwtCodec } from '../auth/crypto/jwt.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { CONFIG, type AppConfig } from '../config.js';

interface SocketData {
  staffId?: string;
  userId?: string;
}

type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/**
 * Zdarzenia na żywo (ADR 0012, arc42 §8.7). Panel łączy się z tokenem operatora i dołącza do pokoi `fleet`
 * (`scooters.read`), `rentals` (`rentals.read`), `tickets` (`tickets.read`), `service` (`service.read`)
 * i `simulator` (`simulator.manage`, tylko przy włączonym sterowaniu symulatorem, ADR 0059); aplikacja łączy się
 * z tokenem klienta i od razu trafia do pokoju `user:{id}` ze zmianami swoich przejazdów, zgłoszeń, powiadomień,
 * wydruków i eksportu danych (ADR 0035, ADR 0036, ADR 0055, ADR 0058, ADR 0066, ADR 0069). Operator trafia przy
 * połączeniu do pokoju `staff:{id}` ze swoimi wydrukami.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class FleetGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server?: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    @Inject(JWT) private readonly jwt: JwtCodec,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly permissions: StaffPermissionsService,
  ) {}

  async handleConnection(socket: ClientSocket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    const now = new Date();
    if (typeof token === 'string') {
      try {
        socket.data.staffId = this.jwt.verify(token, 'staff', now).sub;
        // Własny pokój operatora: gotowe wydruki (`document.ready`, ADR 0066) bez osobnej subskrypcji.
        await socket.join(staffRoom(socket.data.staffId));
        return;
      } catch {
        // Nie jest tokenem operatora; sprawdzamy token klienta.
      }
      try {
        socket.data.userId = this.jwt.verify(token, 'customer', now).sub;
        await socket.join(userRoom(socket.data.userId));
        return;
      } catch {
        // Nieważny token: rozłączenie niżej.
      }
    }
    // Panel i aplikacja po rozłączeniu odświeżają token i łączą się ponownie.
    socket.disconnect(true);
  }

  @SubscribeMessage('fleet.subscribe')
  subscribe(@ConnectedSocket() socket: ClientSocket): Promise<SubscribeAck> {
    return this.joinStaffRoom(socket, FLEET_ROOM, 'scooters.read');
  }

  @SubscribeMessage('rentals.subscribe')
  subscribeRentals(@ConnectedSocket() socket: ClientSocket): Promise<SubscribeAck> {
    return this.joinStaffRoom(socket, RENTALS_ROOM, 'rentals.read');
  }

  @SubscribeMessage('tickets.subscribe')
  subscribeTickets(@ConnectedSocket() socket: ClientSocket): Promise<SubscribeAck> {
    return this.joinStaffRoom(socket, TICKETS_ROOM, 'tickets.read');
  }

  @SubscribeMessage('service.subscribe')
  subscribeService(@ConnectedSocket() socket: ClientSocket): Promise<SubscribeAck> {
    return this.joinStaffRoom(socket, SERVICE_ROOM, 'service.read');
  }

  /** Symulator wyłączony w konfiguracji (ADR 0059) wygląda jak brak uprawnienia. */
  @SubscribeMessage('simulator.subscribe')
  subscribeSimulator(@ConnectedSocket() socket: ClientSocket): Promise<SubscribeAck> {
    if (!this.config.SIMULATOR_CONTROL_ENABLED) return Promise.resolve({ ok: false, code: 'FORBIDDEN' });
    return this.joinStaffRoom(socket, SIMULATOR_ROOM, 'simulator.manage');
  }

  private async joinStaffRoom(socket: ClientSocket, room: string, permission: Permission): Promise<SubscribeAck> {
    const staffId = socket.data.staffId;
    if (!staffId) return { ok: false, code: 'UNAUTHENTICATED' };
    const state = await this.permissions.get(staffId);
    if (!state.active) return { ok: false, code: 'UNAUTHENTICATED' };
    if (!state.permissions.has(permission)) return { ok: false, code: 'FORBIDDEN' };
    await socket.join(room);
    return { ok: true };
  }

  updates(updates: FleetMapScooter[]): void {
    if (updates.length) this.server?.to(FLEET_ROOM).emit('fleet.updates', updates);
  }

  command(command: CommandView): void {
    this.server?.to(FLEET_ROOM).emit('fleet.command', command);
  }

  rentalChanged(rental: RentalListItem): void {
    this.server?.to(RENTALS_ROOM).emit('rentals.changed', rental);
  }

  /** Zmiana stref dla wszystkich połączonych (panel, aplikacja); dane pobiera się przez REST. */
  zonesChanged(zoneIds: string[]): void {
    this.server?.emit('zones.changed', { zoneIds, at: new Date().toISOString() });
  }

  /**
   * Zmiana treści dla wszystkich połączonych (ADR 0062), po zatwierdzeniu transakcji jak `zones.changed`; aplikacja
   * pobiera `GET /content/mobile` z `If-None-Match`. Strona dostaje odświeżenie wywołaniem HTTP (`site.revalidate`).
   */
  contentUpdated(event: ContentUpdated): void {
    this.server?.emit('content.updated', event);
  }

  rentalUpdated(userId: string, rental: RentalView): void {
    this.server?.to(userRoom(userId)).emit('rental.updated', rental);
  }

  walletUpdated(userId: string, wallet: WalletSummary): void {
    this.server?.to(userRoom(userId)).emit('wallet.updated', wallet);
  }

  /**
   * Zgłoszenie: panel (pokój `tickets`) i zgłaszający klient (ADR 0055); treść bez nazwisk i notatek, a klient
   * dostaje wersję bez przypisanego operatora.
   */
  ticketUpdated(ticket: TicketUpdated, reporterId: string | null): void {
    this.server?.to(TICKETS_ROOM).emit('ticket.updated', ticket);
    if (!reporterId) return;
    const forCustomer: TicketUpdated = { ...ticket };
    delete forCustomer.assigneeId;
    this.server?.to(userRoom(reporterId)).emit('ticket.updated', forCustomer);
  }

  serviceTaskUpdated(task: ServiceTaskUpdated): void {
    this.server?.to(SERVICE_ROOM).emit('service-task.updated', task);
  }

  /** Powiadomienie klienta po wysyłce (ADR 0058): baner w wersji web, aplikacja natywna je pomija. */
  notificationCreated(userId: string, notification: NotificationView): void {
    this.server?.to(userRoom(userId)).emit('notification.created', notification);
  }

  /** Wydruk w stanie końcowym (ADR 0066): do zlecającego operatora (`staff:{id}`) albo klienta (`user:{id}`). */
  documentReady(requester: { staffId: string | null; userId: string | null }, document: DocumentReady): void {
    if (requester.staffId) this.server?.to(staffRoom(requester.staffId)).emit('document.ready', document);
    if (requester.userId) this.server?.to(userRoom(requester.userId)).emit('document.ready', document);
  }

  /** Eksport danych gotowy albo nieudany (ADR 0069), do pokoju klienta. */
  dataExportReady(userId: string, event: DataExportReady): void {
    this.server?.to(userRoom(userId)).emit('data-export.ready', event);
  }

  simulatorStatus(status: SimulatorStatusView): void {
    this.server?.to(SIMULATOR_ROOM).emit('simulator.status', status);
  }

  simulatorResult(result: SimulatorResult): void {
    this.server?.to(SIMULATOR_ROOM).emit('simulator.result', result);
  }
}
