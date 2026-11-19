import { Global, Module } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { EntityHistory } from '../audit/entity-history.service.js';
import { AuditLogController, RolesController, StaffController } from './access.controllers.js';
import { LegalDocumentsController, UsersController } from './customers.controllers.js';
import { LegalDocumentsService } from './legal-documents.service.js';
import { RolesService } from './roles.service.js';
import { StaffService } from './staff.service.js';
import { UsersService } from './users.service.js';
import { AccountDataExport } from './account-data-export.js';
import {
  ConsentsController,
  OtpCodesController,
  PermissionsController,
  SavedPlacesController,
  SessionsController,
  StaffInvitationsController,
  StaffSessionsController,
} from './account-lists.controllers.js';
import { AccountListsService } from './account-lists.service.js';

/**
 * Moduł Dostęp w panelu (ADR 0028): operatorzy, role, klienci, dziennik audytu i dokumenty prawne.
 * Globalny, bo zapis z dziennikiem audytu i historię rekordu wykorzystują wszystkie moduły panelu.
 */
@Global()
@Module({
  controllers: [
    StaffController,
    RolesController,
    AuditLogController,
    UsersController,
    LegalDocumentsController,
    // Domknięcie macierzy operacji (ADR 0076).
    ConsentsController,
    SessionsController,
    OtpCodesController,
    SavedPlacesController,
    StaffSessionsController,
    StaffInvitationsController,
    PermissionsController,
  ],
  providers: [
    AuditedTransaction,
    EntityHistory,
    StaffService,
    RolesService,
    UsersService,
    LegalDocumentsService,
    AccountDataExport,
    AccountListsService,
  ],
  exports: [AuditedTransaction, EntityHistory],
})
export class AccessModule {}
