import type { Permission } from '@hulajnogi/core';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

/** Kto może wywołać punkt API (ADR 0035). Punkt bez deklaracji strażnik odrzuca. */
export type Access =
  | { kind: 'public' }
  | { kind: 'customer' }
  /** Zalogowany operator; `permissions` puste = każdy operator (np. własne dane). */
  | { kind: 'staff'; permissions: readonly Permission[] };

export const ACCESS_KEY = 'hulajnogi:access';

/** Punkt dostępny bez logowania (logowanie, dokumenty prawne, stan usługi). */
export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies Access);

/** Punkt aplikacji klienta: wymaga tokenu klienta. */
export const CustomerAuth = () => SetMetadata(ACCESS_KEY, { kind: 'customer' } satisfies Access);

/** Punkt panelu: wymaga operatora ze wszystkimi podanymi uprawnieniami (ADR 0028). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(ACCESS_KEY, { kind: 'staff', permissions } satisfies Access);

/** Punkt dla każdego zalogowanego operatora (bez konkretnego uprawnienia). */
export const StaffAuth = () => SetMetadata(ACCESS_KEY, { kind: 'staff', permissions: [] } satisfies Access);

export interface StaffPrincipal {
  kind: 'staff';
  staffId: string;
  sessionId: string;
}

export interface CustomerPrincipal {
  kind: 'customer';
  userId: string;
  sessionId: string;
}

export type Principal = StaffPrincipal | CustomerPrincipal;

export interface AuthenticatedRequest {
  principal?: Principal;
  headers: Record<string, string | string[] | undefined>;
}

/** Operator z tokenu (tylko w punktach z `@RequirePermission` albo `@StaffAuth`). */
export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffPrincipal => {
  const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (principal?.kind !== 'staff') throw new Error('CurrentStaff użyty w punkcie bez uwierzytelnienia operatora');
  return principal;
});

/** Klient z tokenu (tylko w punktach z `@CustomerAuth`). */
export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerPrincipal => {
  const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (principal?.kind !== 'customer') throw new Error('CurrentCustomer użyty w punkcie bez uwierzytelnienia klienta');
  return principal;
});
