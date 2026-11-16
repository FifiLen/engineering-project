import { DomainError } from '@hulajnogi/core';
import {
  FLEET_ROOM,
  type ClientToServerEvents,
  type CommandView,
  type FleetMapScooter,
  type ServerToClientEvents,
  type SubscribeAck,
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
}

/**
 * Pokój `fleet` dla panelu (ADR 0012, arc42 §8.7). Połączenie wymaga tokenu dostępowego operatora
 * w `auth.token`, a dołączenie do pokoju uprawnienia `scooters.read` (ADR 0035).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class FleetGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server?: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    @Inject(JWT) private readonly jwt: JwtCodec,
    private readonly permissions: StaffPermissionsService,
  ) {}

  handleConnection(socket: Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>): void {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    try {
      if (typeof token !== 'string') throw new DomainError('UNAUTHENTICATED');
      socket.data.staffId = this.jwt.verify(token, 'staff', new Date()).sub;
    } catch {
      // Panel po rozłączeniu odświeża token i łączy się ponownie.
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('fleet.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>): Promise<SubscribeAck> {
    const staffId = socket.data.staffId;
    if (!staffId) return { ok: false, code: 'UNAUTHENTICATED' };
    const state = await this.permissions.get(staffId);
    if (!state.active) return { ok: false, code: 'UNAUTHENTICATED' };
    if (!state.permissions.has('scooters.read')) return { ok: false, code: 'FORBIDDEN' };
    await socket.join(FLEET_ROOM);
    return { ok: true };
  }

  updates(updates: FleetMapScooter[]): void {
    if (updates.length) this.server?.to(FLEET_ROOM).emit('fleet.updates', updates);
  }

  command(command: CommandView): void {
    this.server?.to(FLEET_ROOM).emit('fleet.command', command);
  }
}
