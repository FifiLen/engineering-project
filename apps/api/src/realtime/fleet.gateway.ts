import {
  FLEET_ROOM,
  type ClientToServerEvents,
  type CommandView,
  type FleetMapScooter,
  type ServerToClientEvents,
} from '@hulajnogi/shared';
import { ConnectedSocket, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * Pokój `fleet` dla panelu (ADR 0012, arc42 §8.7). Od iteracji 2 dołączenie wymaga zalogowanego
 * operatora z uprawnieniem `scooters.read`.
 */
@WebSocketGateway({ cors: { origin: true } })
export class FleetGateway {
  @WebSocketServer()
  private readonly server?: Server<ClientToServerEvents, ServerToClientEvents>;

  @SubscribeMessage('fleet.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket): Promise<{ ok: true }> {
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
