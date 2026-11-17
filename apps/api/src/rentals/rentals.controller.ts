import {
  nearbyQuerySchema,
  notificationPreferencesSchema,
  scooterRequestSchema,
  type NearbyQuery,
  type NotificationPreferences,
  type ScooterRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentCustomer, CustomerAuth, type CustomerPrincipal } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { RentalsService } from './rentals.service.js';

const idParam = new ZodPipe(z.uuid());
const numberParam = new ZodPipe(z.coerce.number().int().min(1).max(9999));
const historyQuery = new ZodPipe(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }));

/** Aplikacja klienta: mapa, hulajnoga, rezerwacja i przejazd (ADR 0036, ADR 0041). */
@ApiTags('aplikacja: wypożyczenie')
@CustomerAuth()
@Controller()
export class RentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Get('scooters/nearby')
  @ApiOperation({ summary: 'Wolne hulajnogi w promieniu 2 km (najwyżej 50) z progiem baterii z cennika' })
  nearby(@Query(new ZodPipe(nearbyQuerySchema)) query: NearbyQuery) {
    return this.rentals.nearby(query.lat, query.lon);
  }

  @Get('scooters/by-number/:number')
  @ApiOperation({ summary: 'Hulajnoga po numerze z kodu QR albo wpisanym ręcznie, z przyczyną niedostępności' })
  byNumber(@CurrentCustomer() customer: CustomerPrincipal, @Param('number', numberParam) number: number) {
    return this.rentals.scooterByNumber(customer.userId, number);
  }

  @Post('scooters/:id/ring')
  @HttpCode(202)
  @ApiOperation({ summary: 'Dzwonek: przy własnej rezerwacji albo przy wolnej hulajnodze' })
  async ring(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string): Promise<void> {
    await this.rentals.ring(customer.userId, id);
  }

  @Post('reservations')
  @ApiOperation({ summary: 'Rezerwacja (201); powtórzona rezerwacja tej samej hulajnogi zwraca istniejącą (200)' })
  async reserve(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(scooterRequestSchema)) body: ScooterRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { rental, created } = await this.rentals.reserve(customer.userId, body.scooterId);
    void reply.status(created ? 201 : 200);
    return rental;
  }

  @Delete('reservations/current')
  @ApiOperation({ summary: 'Anulowanie własnej rezerwacji (RESERVED → EXPIRED z powodem)' })
  cancel(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.rentals.cancelReservation(customer.userId);
  }

  @Post('rentals')
  @ApiOperation({
    summary:
      'Start przejazdu z rezerwacji albo po skanie (202, odblokowanie czeka na potwierdzenie); ponowione żądanie zwraca otwarty przejazd (200)',
  })
  async start(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(scooterRequestSchema)) body: ScooterRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { rental, created } = await this.rentals.start(customer.userId, body.scooterId);
    void reply.status(created ? 202 : 200);
    return rental;
  }

  @Get('rentals/current')
  @ApiOkResponse({ description: 'Otwarty przejazd albo rezerwacja klienta; `rental: null`, gdy nie ma' })
  async current(@CurrentCustomer() customer: CustomerPrincipal) {
    return { rental: await this.rentals.current(customer.userId) };
  }

  @Post('rentals/current/pause')
  @HttpCode(202)
  @ApiOperation({ summary: 'Pauza: komenda lock, stan PAUSED po potwierdzeniu' })
  pause(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.rentals.pause(customer.userId);
  }

  @Post('rentals/current/resume')
  @HttpCode(202)
  @ApiOperation({ summary: 'Wznowienie: komenda unlock, stan ACTIVE po potwierdzeniu' })
  resume(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.rentals.resume(customer.userId);
  }

  @Post('rentals/current/end')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Zakończenie w strefie parkowania: ENDING, ENDED po potwierdzeniu blokady; poza strefą 422 OUTSIDE_PARKING',
  })
  end(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.rentals.end(customer.userId);
  }

  @Get('rentals')
  @ApiOkResponse({ description: 'Historia zakończonych przejazdów, od najnowszego' })
  history(@CurrentCustomer() customer: CustomerPrincipal, @Query(historyQuery) query: { limit: number }) {
    return this.rentals.history(customer.userId, query.limit);
  }

  @Get('rentals/:id')
  @ApiOkResponse({ description: 'Przejazd klienta z licznikami i kwotą (podsumowanie)' })
  details(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.rentals.viewFor(customer.userId, id);
  }
}

/** Profil, ustawienia powiadomień i usunięcie konta (dług z iteracji 2). */
@ApiTags('aplikacja: konto')
@CustomerAuth()
@Controller('me')
export class CustomerAccountController {
  constructor(private readonly rentals: RentalsService) {}

  @Get('profile')
  @ApiOkResponse({ description: 'Statystyki przejazdów, saldo portfela i preferencje powiadomień' })
  profile(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.rentals.profile(customer.userId);
  }

  @Patch('notifications')
  notifications(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(notificationPreferencesSchema)) body: NotificationPreferences,
  ) {
    return this.rentals.setNotifications(customer.userId, body);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie konta: bez otwartego przejazdu i z saldem 0; dane osobowe są anonimizowane' })
  async remove(@CurrentCustomer() customer: CustomerPrincipal): Promise<void> {
    await this.rentals.deleteAccount(customer.userId);
  }
}
