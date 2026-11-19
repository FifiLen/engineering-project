import {
  auditLogResource,
  roleCreateSchema,
  rolesResource,
  roleUpdateSchema,
  staffActionSchema,
  staffInviteSchema,
  staffResource,
  staffUpdateSchema,
  type ListQuery,
  type RoleCreate,
  type RoleUpdate,
  type StaffAction,
  type StaffInvite,
  type StaffUpdate,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { notFound } from '@hulajnogi/core';
import { type Database, DrizzleAuditLogRepository } from '@hulajnogi/db';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { EntityHistory } from '../audit/entity-history.service.js';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { DB } from '../database/database.module.js';
import { idParam, versionQuery } from '../fleet/scooters.controller.js';
import { RolesService } from './roles.service.js';
import { StaffService } from './staff.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

/** Zasób panelu `staff`: operatorzy (ADR 0028, ADR 0031). */
@ApiTags('panel: operatorzy i role')
@Controller('admin/staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('staff.read')
  @Get()
  list(@Query(new ListQueryPipe(staffResource)) query: ListQuery) {
    return this.staff.list(query);
  }

  @RequirePermission('staff.read')
  @ListExport('operatorzy')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, staffResource, body, (db, query) => this.staff.list(query, db));
  }

  @RequirePermission('staff.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.staff.details(id);
  }

  @RequirePermission('staff.read')
  @Get(':id/history')
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('staff', id);
  }

  @RequirePermission('staff.manage')
  @Post()
  @ApiOperation({ summary: 'Zaproszenie operatora: konto bez hasła z rolami i link aktywacji (72 h)' })
  invite(@CurrentStaff() actor: StaffPrincipal, @Body(new ZodPipe(staffInviteSchema)) body: StaffInvite) {
    return this.staff.invite(actor.staffId, body);
  }

  @RequirePermission('staff.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Dane i role operatora; nie można zmienić własnych ról ani odebrać ostatniego roles.manage' })
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(staffUpdateSchema)) body: StaffUpdate,
  ) {
    return this.staff.update(actor.staffId, id, body);
  }

  @RequirePermission('staff.manage')
  @Delete(':id')
  @ApiOperation({ summary: 'Dezaktywacja operatora z wylogowaniem ze wszystkich urządzeń' })
  deactivate(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ) {
    return this.staff.deactivate(actor.staffId, id, version);
  }

  @RequirePermission('staff.manage')
  @Post(':id/invitation')
  @HttpCode(200)
  resendInvitation(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(staffActionSchema)) body: StaffAction,
  ) {
    return this.staff.resendInvitation(actor.staffId, id, body.version);
  }

  @RequirePermission('staff.manage')
  @Post(':id/totp-reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset TOTP: konfiguracja przy następnym logowaniu, sesje wygasają' })
  resetTotp(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(staffActionSchema)) body: StaffAction,
  ) {
    return this.staff.resetTotp(actor.staffId, id, body.version);
  }

  @RequirePermission('staff.manage')
  @Post(':id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(@CurrentStaff() actor: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.staff.revokeSessions(actor.staffId, id);
  }
}

/** Zasób panelu `roles` i katalog uprawnień do macierzy (ADR 0028). */
@ApiTags('panel: operatorzy i role')
@Controller('admin')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('staff.read')
  @Get('permissions/catalog')
  @ApiOperation({
    summary: 'Katalog uprawnień z modułami i opisami (macierz roli; lista z filtrami to GET /admin/permissions)',
  })
  catalog() {
    return this.roles.catalog();
  }

  @RequirePermission('staff.read')
  @Get('roles')
  list(@Query(new ListQueryPipe(rolesResource)) query: ListQuery) {
    return this.roles.list(query);
  }

  @RequirePermission('staff.read')
  @ListExport('role', 'roles/export')
  exportRoles(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, rolesResource, body, (db, query) => this.roles.list(query, db));
  }

  @RequirePermission('staff.read')
  @Get('roles/:id')
  details(@Param('id', idParam) id: string) {
    return this.roles.details(id);
  }

  @RequirePermission('staff.read')
  @Get('roles/:id/history')
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('role', id);
  }

  @RequirePermission('roles.manage')
  @Post('roles')
  create(@CurrentStaff() actor: StaffPrincipal, @Body(new ZodPipe(roleCreateSchema)) body: RoleCreate) {
    return this.roles.create(actor.staffId, body);
  }

  @RequirePermission('roles.manage')
  @Patch('roles/:id')
  @ApiOperation({ summary: 'Nazwa, opis i macierz uprawnień z wersją rekordu' })
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(roleUpdateSchema)) body: RoleUpdate,
  ) {
    return this.roles.update(actor.staffId, id, body);
  }

  @RequirePermission('roles.manage')
  @Delete('roles/:id')
  @ApiOperation({ summary: 'Usunięcie roli własnej bez operatorów (systemowej nie można usunąć)' })
  remove(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ) {
    return this.roles.remove(actor.staffId, id, version);
  }
}

/** Dziennik audytu: tylko odczyt (tabela tylko do dopisywania, pytanie 4 do prowadzącego). */
@ApiTags('panel: operatorzy i role')
@Controller('admin/audit-log')
export class AuditLogController {
  private readonly audit: DrizzleAuditLogRepository;

  constructor(
    @Inject(DB) db: Database,
    private readonly exporter: ListExportService,
  ) {
    this.audit = new DrizzleAuditLogRepository(db);
  }

  @RequirePermission('audit.read')
  @Get()
  list(@Query(new ListQueryPipe(auditLogResource)) query: ListQuery) {
    return this.audit.list(query);
  }

  @RequirePermission('audit.read')
  @ListExport('dziennik audytu')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, auditLogResource, body, (db, query) =>
      new DrizzleAuditLogRepository(db).list(query),
    );
  }

  @RequirePermission('audit.read')
  @Get(':id')
  async details(@Param('id', new ZodPipe(z.coerce.number().int().positive())) id: number) {
    const entry = await this.audit.details(id);
    if (!entry) throw notFound('auditLog', String(id));
    return entry;
  }
}
