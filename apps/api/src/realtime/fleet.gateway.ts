import {
  FLEET_ROOM,
  RENTALS_ROOM,
  userRoom,
  type ClientToServerEvents,
  type CommandView,
  type FleetMapScooter,
  type RentalListItem,
  type RentalView,
  type ServerToClientEvents,
  type SubscribeAck,
  type WalletSummary,
} from '@hulajnogi/shared';
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

interface SocketData {
  staffId?: string;
  userId?: string;
}

type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/**
 * Zdarzenia na żywo (ADR 0012, arc42 §8.7). Panel łączy się z tokenem operatora i dołącza do pokoi `fleet`
 * (`scooters.read`) i `rentals` (`rentals.read`); aplikacja łączy się z tokenem klienta i od razu trafia
 * do pokoju `user:{id}` ze zmianami swoich przejazdów (ADR 0035, ADR 0036).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class FleetGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server?: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    @Inject(JWT) private readonly jwt: JwtCodec,
    private readonly permissions: StaffPermissionsService,
  ) {}

  async handleConnection(socket: ClientSocket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    const now = new Date();
    if (typeof token === 'string') {
      try {
        socket.data.staffId = this.jwt.verify(token, 'staff', now).sub;
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

  private async joinStaffRoom(
    socket: ClientSocket,
    room: string,
    permission: 'scooters.read' | 'rentals.read',
  ): Promise<SubscribeAck> {
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

  rentalUpdated(userId: string, rental: RentalView): void {
    this.server?.to(userRoom(userId)).emit('rental.updated', rental);
  }

  walletUpdated(userId: string, wallet: WalletSummary): void {
    this.server?.to(userRoom(userId)).emit('wallet.updated', wallet);
  }
}
