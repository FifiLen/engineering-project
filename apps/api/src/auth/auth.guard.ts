import { DomainError, unauthenticated } from '@hulajnogi/core';
import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_KEY, type Access, type AuthenticatedRequest } from './decorators.js';
import { JWT } from './auth.tokens.js';
import type { JwtCodec } from './crypto/jwt.js';
import { StaffPermissionsService } from './staff-permissions.service.js';

/** Token z nagłówka `Authorization: Bearer …`. */
export function bearerToken(headers: AuthenticatedRequest['headers']): string | null {
  const value = headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * Jeden strażnik dla całego API (ADR 0035): czyta deklarację dostępu z dekoratora, weryfikuje token
 * i uprawnienia. Punkt HTTP bez deklaracji jest odrzucany, żeby brak `@RequirePermission` był błędem.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(JWT) private readonly jwt: JwtCodec,
    private readonly staffPermissions: StaffPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Socket.IO uwierzytelnia bramka przy połączeniu.
    if (context.getType() !== 'http') return true;
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { url?: string }>();
    if (!access) {
      this.logger.error(`Punkt bez deklaracji dostępu: ${request.url ?? '?'}`);
      throw new DomainError('PERMISSION_NOT_DECLARED');
    }
    if (access.kind === 'public') return true;

    const token = bearerToken(request.headers);
    if (!token) throw unauthenticated('TOKEN_MISSING');
    const now = new Date();

    if (access.kind === 'customer') {
      const claims = this.jwt.verify(token, 'customer', now);
      request.principal = { kind: 'customer', userId: claims.sub, sessionId: claims.sid! };
      return true;
    }

    const claims = this.jwt.verify(token, 'staff', now);
    const state = await this.staffPermissions.get(claims.sub);
    if (!state.active) throw unauthenticated('STAFF_INACTIVE');
    for (const permission of access.permissions) state.permissions.require(permission);
    request.principal = { kind: 'staff', staffId: claims.sub, sessionId: claims.sid! };
    return true;
  }
}
