import {
  consentRevokeSchema,
  consentsResource,
  otpCodesResource,
  permissionsResource,
  permissionUpdateSchema,
  savedPlacesResource,
  sessionRevokeSchema,
  sessionsResource,
  staffInvitationsResource,
  staffSessionsResource,
  type ConsentRevoke,
  type ListExportRequest,
  type ListQuery,
  type PermissionUpdate,
  type SessionRevoke,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { idParam } from '../fleet/scooters.controller.js';
import { AccountListsService } from './account-lists.service.js';

const sessionRevokeBody = new ZodPipe(sessionRevokeSchema.default({}));

/** Użytkownicy → Zgody (ADR 0076): lista `users.read`, wycofanie zgody marketingowej `users.manage`. */
@ApiTags('panel: klienci')
@Controller('admin/consents')
export class ConsentsController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({
    summary: 'Zgody klientów (typ, wersja dokumentu, źródło, stan liczony w widoku) według wzorca listy',
  })
  list(@Query(new ListQueryPipe(consentsResource)) query: ListQuery) {
    return this.lists.consents(query);
  }

  @RequirePermission('users.read')
  @ListExport('zgody')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, consentsResource, body, (db, query) =>
      this.lists.consents(query, db),
    );
  }

  @RequirePermission('users.manage')
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Wycofanie zgody marketingowej z powodem (wpis consent.revoked); regulamin, polityka i wiek to 409 CONSENT_NOT_REVOCABLE',
  })
  revoke(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(consentRevokeSchema)) body: ConsentRevoke,
  ) {
    return this.lists.revokeConsent(staff.staffId, id, body.reason);
  }
}

/** Użytkownicy → Sesje (ADR 0076): wiersz na rodzinę tokenów; unieważnienie jednej rodziny `users.manage`. */
@ApiTags('panel: klienci')
@Controller('admin/sessions')
export class SessionsController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({ summary: 'Sesje klientów (jedna na logowanie, bez skrótów tokenów) według wzorca listy' })
  list(@Query(new ListQueryPipe(sessionsResource)) query: ListQuery) {
    return this.lists.sessions(query);
  }

  @RequirePermission('users.read')
  @ListExport('sesje klientów')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, sessionsResource, body, (db, query) =>
      this.lists.sessions(query, db),
    );
  }

  @RequirePermission('users.manage')
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Unieważnienie rodziny sesji (id z listy) z opcjonalnym powodem; token dostępu działa do 15 min; wpis session.revoked',
  })
  revoke(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(sessionRevokeBody) body: SessionRevoke,
  ) {
    return this.lists.revokeSession(staff.staffId, id, body.reason);
  }
}

/** Użytkownicy → Kody SMS (ADR 0076): lista `users.read` bez skrótów i z numerem zamaskowanym, „Usuń wygasłe” `users.manage`. */
@ApiTags('panel: klienci')
@Controller('admin/otp-codes')
export class OtpCodesController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({ summary: 'Kody SMS (cel, stan, próby; numer zamaskowany w bazie) według wzorca listy' })
  list(@Query(new ListQueryPipe(otpCodesResource)) query: ListQuery) {
    return this.lists.otpCodes(query);
  }

  @RequirePermission('users.read')
  @ListExport('kody SMS')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, otpCodesResource, body, (db, query) =>
      this.lists.otpCodes(query, db),
    );
  }

  @RequirePermission('users.manage')
  @Get('purge')
  @ApiOperation({ summary: 'Podgląd „Usuń wygasłe kody”: liczba kodów wygasłych ponad dobę temu (warunek procedury)' })
  purgeable() {
    return this.lists.purgeableOtp();
  }

  @RequirePermission('users.manage')
  @Post('purge')
  @HttpCode(200)
  @ApiOperation({ summary: '„Usuń wygasłe kody” (sp_purge_expired_otp): faktyczna liczba usuniętych, wpis otp.purged' })
  purge(@CurrentStaff() staff: StaffPrincipal) {
    return this.lists.purgeOtp(staff.staffId);
  }
}

/** Karta klienta → Zapisane miejsca (ADR 0076): lista `users.read` z filtrem klienta, usunięcie `users.manage`. */
@ApiTags('panel: klienci')
@Controller('admin/saved-places')
export class SavedPlacesController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  @ApiOperation({ summary: 'Zapisane miejsca klientów (na karcie klienta z filtrem userId) według wzorca listy' })
  list(@Query(new ListQueryPipe(savedPlacesResource)) query: ListQuery) {
    return this.lists.savedPlaces(query);
  }

  @RequirePermission('users.read')
  @ListExport('zapisane miejsca')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, savedPlacesResource, body, (db, query) =>
      this.lists.savedPlaces(query, db),
    );
  }

  @RequirePermission('users.manage')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie zapisanego miejsca klienta (wpis saved_place.deleted)' })
  async remove(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string): Promise<void> {
    await this.lists.deleteSavedPlace(staff.staffId, id);
  }
}

/** Operatorzy i role → Sesje (ADR 0076): lista `staff.read`, unieważnienie rodziny `staff.manage`. */
@ApiTags('panel: operatorzy i role')
@Controller('admin/staff-sessions')
export class StaffSessionsController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('staff.read')
  @Get()
  @ApiOperation({ summary: 'Sesje operatorów (przeglądarka, zapamiętanie urządzenia, stan) według wzorca listy' })
  list(@Query(new ListQueryPipe(staffSessionsResource)) query: ListQuery) {
    return this.lists.staffSessions(query);
  }

  @RequirePermission('staff.read')
  @ListExport('sesje operatorów')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, staffSessionsResource, body, (db, query) =>
      this.lists.staffSessions(query, db),
    );
  }

  @RequirePermission('staff.manage')
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unieważnienie rodziny sesji operatora; token dostępu działa do 15 min; wpis session.revoked',
  })
  revoke(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(sessionRevokeBody) body: SessionRevoke,
  ) {
    return this.lists.revokeStaffSession(staff.staffId, id, body.reason);
  }
}

/** Operatorzy i role → Zaproszenia (ADR 0076): lista `staff.read`, ponowne wysłanie i unieważnienie `staff.manage`. */
@ApiTags('panel: operatorzy i role')
@Controller('admin/staff-invitations')
export class StaffInvitationsController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('staff.read')
  @Get()
  @ApiOperation({ summary: 'Zaproszenia operatorów (stan, ponowne wysłanie, zastąpienie) według wzorca listy' })
  list(@Query(new ListQueryPipe(staffInvitationsResource)) query: ListQuery) {
    return this.lists.staffInvitations(query);
  }

  @RequirePermission('staff.read')
  @ListExport('zaproszenia operatorów')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, staffInvitationsResource, body, (db, query) =>
      this.lists.staffInvitations(query, db),
    );
  }

  @RequirePermission('staff.manage')
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unieważnienie oczekującego zaproszenia (409 INVITATION_NOT_PENDING); wpis staff.invitation_revoked',
  })
  revoke(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.lists.revokeInvitation(staff.staffId, id);
  }

  @RequirePermission('staff.manage')
  @Post(':id/resend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Ponowne wysłanie: nowe zaproszenie zastępuje otwarte (replaced_by), link pokazywany raz; wpis staff.invitation_resent',
  })
  resend(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.lists.resendInvitation(staff.staffId, id);
  }
}

/** Operatorzy i role → Uprawnienia (ADR 0076): lista i opis z `roles.manage`; kody z katalogu w core. */
@ApiTags('panel: operatorzy i role')
@Controller('admin/permissions')
export class PermissionsController {
  constructor(
    private readonly lists: AccountListsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('roles.manage')
  @Get()
  @ApiOperation({ summary: 'Uprawnienia (kod, grupa, opis, role) według wzorca listy; katalog do macierzy: /catalog' })
  list(@Query(new ListQueryPipe(permissionsResource)) query: ListQuery) {
    return this.lists.permissions(query);
  }

  @RequirePermission('roles.manage')
  @ListExport('uprawnienia')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, permissionsResource, body, (db, query) =>
      this.lists.permissions(query, db),
    );
  }

  @RequirePermission('roles.manage')
  @Patch(':code')
  @ApiOperation({
    summary: 'Opis uprawnienia (do 160 znaków) z blokadą optymistyczną (409 CONFLICT); wpis permission.updated',
  })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('code', new ZodPipe(z.string().regex(/^[a-z_]+\.[a-z_]+$/))) code: string,
    @Body(new ZodPipe(permissionUpdateSchema)) body: PermissionUpdate,
  ) {
    return this.lists.updatePermission(staff.staffId, code, body);
  }
}
