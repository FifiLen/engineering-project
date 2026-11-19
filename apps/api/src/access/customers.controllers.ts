import {
  documentDraftUpdateSchema,
  userBlockSchema,
  usersResource,
  userUpdateSchema,
  type DocumentDraftUpdate,
  type ListQuery,
  type UserBlock,
  type UserUpdate,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { EntityHistory } from '../audit/entity-history.service.js';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { idParam } from '../fleet/scooters.controller.js';
import { LegalDocumentsService } from './legal-documents.service.js';
import { UsersService } from './users.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const versionBody = new ZodPipe(z.object({ version: z.number().int().min(1) }));

/** Zasób panelu `users`: klienci aplikacji (ADR 0028). */
@ApiTags('panel: klienci')
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly history: EntityHistory,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  list(@Query(new ListQueryPipe(usersResource)) query: ListQuery) {
    return this.users.list(query);
  }

  @RequirePermission('users.read')
  @ListExport('klienci')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, usersResource, body, (db, query) => this.users.list(query, db));
  }

  @RequirePermission('users.read')
  @Get(':id')
  @ApiOperation({ summary: 'Klient ze zgodami (wersje dokumentów) i aktywnymi sesjami' })
  details(@Param('id', idParam) id: string) {
    return this.users.details(id);
  }

  @RequirePermission('users.read')
  @Get(':id/history')
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('user', id);
  }

  @RequirePermission('users.manage')
  @Patch(':id')
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(userUpdateSchema)) body: UserUpdate,
  ) {
    return this.users.update(actor.staffId, id, body);
  }

  @RequirePermission('users.manage')
  @Post(':id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Blokada z powodem widocznym dla klienta; wylogowuje ze wszystkich urządzeń' })
  block(@CurrentStaff() actor: StaffPrincipal, @Param('id', idParam) id: string, @Body(new ZodPipe(userBlockSchema)) body: UserBlock) {
    return this.users.block(actor.staffId, id, body);
  }

  @RequirePermission('users.manage')
  @Post(':id/unblock')
  @HttpCode(200)
  unblock(@CurrentStaff() actor: StaffPrincipal, @Param('id', idParam) id: string, @Body(versionBody) body: { version: number }) {
    return this.users.unblock(actor.staffId, id, body.version);
  }

  @RequirePermission('users.manage')
  @Post(':id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(@CurrentStaff() actor: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.users.revokeSessions(actor.staffId, id);
  }
}

/** Dokumenty prawne z wersjami (ADR 0027); pierwsza zakładka „Treści” w panelu. */
@ApiTags('panel: treści')
@Controller('admin/legal-documents')
export class LegalDocumentsController {
  constructor(
    private readonly documents: LegalDocumentsService,
    private readonly history: EntityHistory,
  ) {}

  @RequirePermission('content.read')
  @Get()
  list() {
    return this.documents.list();
  }

  @RequirePermission('content.read')
  @Get(':id')
  @ApiOperation({ summary: 'Dokument z wersjami i liczbą akceptacji każdej wersji' })
  details(@Param('id', idParam) id: string) {
    return this.documents.details(id);
  }

  @RequirePermission('content.read')
  @Get(':id/history')
  historyOf(@Param('id', idParam) id: string) {
    return this.history.of('legal_document', id);
  }

  @RequirePermission('content.read')
  @Get('versions/:versionId')
  version(@Param('versionId', idParam) versionId: string) {
    return this.documents.version(versionId);
  }

  @RequirePermission('content.write')
  @Post(':id/drafts')
  @ApiOperation({ summary: 'Nowa wersja robocza z treści obowiązującej wersji' })
  startDraft(@CurrentStaff() actor: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.documents.startDraft(actor.staffId, id);
  }

  @RequirePermission('content.write')
  @Patch('versions/:versionId')
  updateDraft(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('versionId', idParam) versionId: string,
    @Body(new ZodPipe(documentDraftUpdateSchema)) body: DocumentDraftUpdate,
  ) {
    return this.documents.updateDraft(actor.staffId, versionId, body);
  }

  @RequirePermission('content.write')
  @Post('versions/:versionId/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publikacja: wersja obowiązuje od razu, klienci akceptują ją ponownie' })
  publish(@CurrentStaff() actor: StaffPrincipal, @Param('versionId', idParam) versionId: string) {
    return this.documents.publish(actor.staffId, versionId);
  }

  @RequirePermission('content.write')
  @Delete('versions/:versionId')
  @HttpCode(204)
  async deleteDraft(@CurrentStaff() actor: StaffPrincipal, @Param('versionId', idParam) versionId: string): Promise<void> {
    await this.documents.deleteDraft(actor.staffId, versionId);
  }
}
