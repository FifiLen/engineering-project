import { relations } from 'drizzle-orm/relations';
import {
  users,
  savedPlaces,
  contentPageVersions,
  consents,
  staff,
  tariffs,
  sessions,
  pushTokens,
  scooterCommands,
  rentals,
  scooters,
  zones,
  scooterModels,
  paymentMethods,
  payments,
  rentalEvents,
  wallets,
  files,
  walletLedger,
  refunds,
  auditLog,
  mediaAssets,
  contentPages,
  notificationTemplates,
  contentBlocks,
  faqCategories,
  faqItems,
  permissions,
  reportDefinitions,
  reportRuns,
  news,
  documentTemplates,
  documentTemplateVersions,
  receipts,
  serviceTasks,
  tickets,
  staffSessions,
  staffInvitations,
  scooterZoneControl,
  paymentWebhookEvents,
  spareParts,
  sparePartMovements,
  notifications,
  notificationTemplateVersions,
  generatedDocuments,
  companyProfile,
  dataExports,
  rolePermissions,
  roles,
  ticketPhotos,
  staffRoles,
  serviceTaskParts,
  paymentCustomers,
  scooterZonePresence,
  receiptItems,
} from './schema.js';

export const savedPlacesRelations = relations(savedPlaces, ({ one }) => ({
  user: one(users, {
    fields: [savedPlaces.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  savedPlaces: many(savedPlaces),
  consents: many(consents),
  sessions: many(sessions),
  pushTokens: many(pushTokens),
  payments: many(payments),
  wallets: many(wallets),
  paymentMethods: many(paymentMethods),
  rentals: many(rentals),
  receipts: many(receipts),
  refunds: many(refunds),
  tickets: many(tickets),
  files: many(files),
  notifications: many(notifications),
  generatedDocuments: many(generatedDocuments),
  dataExports: many(dataExports),
  paymentCustomers: many(paymentCustomers),
}));

export const consentsRelations = relations(consents, ({ one }) => ({
  contentPageVersion: one(contentPageVersions, {
    fields: [consents.pageVersionId],
    references: [contentPageVersions.id],
  }),
  user: one(users, {
    fields: [consents.userId],
    references: [users.id],
  }),
}));

export const contentPageVersionsRelations = relations(contentPageVersions, ({ one, many }) => ({
  consents: many(consents),
  staff: one(staff, {
    fields: [contentPageVersions.createdBy],
    references: [staff.id],
  }),
  contentPage: one(contentPages, {
    fields: [contentPageVersions.pageId],
    references: [contentPages.id],
  }),
}));

export const tariffsRelations = relations(tariffs, ({ one, many }) => ({
  staff: one(staff, {
    fields: [tariffs.createdBy],
    references: [staff.id],
  }),
  rentals: many(rentals),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  tariffs: many(tariffs),
  scooterCommands: many(scooterCommands),
  zones: many(zones),
  walletLedgers: many(walletLedger),
  auditLogs: many(auditLog),
  mediaAssets: many(mediaAssets),
  contentPageVersions: many(contentPageVersions),
  notificationTemplates: many(notificationTemplates),
  contentBlocks: many(contentBlocks),
  faqItems: many(faqItems),
  reportDefinitions: many(reportDefinitions),
  reportRuns: many(reportRuns),
  news_createdBy: many(news, {
    relationName: 'news_createdBy_staff_id',
  }),
  news_updatedBy: many(news, {
    relationName: 'news_updatedBy_staff_id',
  }),
  documentTemplates_createdBy: many(documentTemplates, {
    relationName: 'documentTemplates_createdBy_staff_id',
  }),
  documentTemplates_updatedBy: many(documentTemplates, {
    relationName: 'documentTemplates_updatedBy_staff_id',
  }),
  documentTemplateVersions_activatedBy: many(documentTemplateVersions, {
    relationName: 'documentTemplateVersions_activatedBy_staff_id',
  }),
  documentTemplateVersions_uploadedBy: many(documentTemplateVersions, {
    relationName: 'documentTemplateVersions_uploadedBy_staff_id',
  }),
  serviceTasks_assigneeId: many(serviceTasks, {
    relationName: 'serviceTasks_assigneeId_staff_id',
  }),
  serviceTasks_cancelledBy: many(serviceTasks, {
    relationName: 'serviceTasks_cancelledBy_staff_id',
  }),
  serviceTasks_createdBy: many(serviceTasks, {
    relationName: 'serviceTasks_createdBy_staff_id',
  }),
  staffSessions: many(staffSessions),
  staffInvitations_invitedBy: many(staffInvitations, {
    relationName: 'staffInvitations_invitedBy_staff_id',
  }),
  staffInvitations_staffId: many(staffInvitations, {
    relationName: 'staffInvitations_staffId_staff_id',
  }),
  refunds: many(refunds),
  tickets: many(tickets),
  sparePartMovements: many(sparePartMovements),
  files: many(files),
  notificationTemplateVersions: many(notificationTemplateVersions),
  generatedDocuments: many(generatedDocuments),
  companyProfiles: many(companyProfile),
  staffRoles_assignedBy: many(staffRoles, {
    relationName: 'staffRoles_assignedBy_staff_id',
  }),
  staffRoles_staffId: many(staffRoles, {
    relationName: 'staffRoles_staffId_staff_id',
  }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  session: one(sessions, {
    fields: [sessions.replacedBy],
    references: [sessions.id],
    relationName: 'sessions_replacedBy_sessions_id',
  }),
  sessions: many(sessions, {
    relationName: 'sessions_replacedBy_sessions_id',
  }),
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  pushTokens: many(pushTokens),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  session: one(sessions, {
    fields: [pushTokens.sessionId],
    references: [sessions.id],
  }),
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

export const scooterCommandsRelations = relations(scooterCommands, ({ one, many }) => ({
  staff: one(staff, {
    fields: [scooterCommands.issuedByStaff],
    references: [staff.id],
  }),
  rental: one(rentals, {
    fields: [scooterCommands.rentalId],
    references: [rentals.id],
  }),
  scooter: one(scooters, {
    fields: [scooterCommands.scooterId],
    references: [scooters.id],
  }),
  scooterZoneControls_limitCommandId: many(scooterZoneControl, {
    relationName: 'scooterZoneControl_limitCommandId_scooterCommands_id',
  }),
  scooterZoneControls_stopCommandId: many(scooterZoneControl, {
    relationName: 'scooterZoneControl_stopCommandId_scooterCommands_id',
  }),
}));

export const rentalsRelations = relations(rentals, ({ one, many }) => ({
  scooterCommands: many(scooterCommands),
  payments: many(payments),
  rentalEvents: many(rentalEvents),
  zone: one(zones, {
    fields: [rentals.endZoneId],
    references: [zones.id],
  }),
  paymentMethod: one(paymentMethods, {
    fields: [rentals.paymentMethodId],
    references: [paymentMethods.id],
  }),
  file: one(files, {
    fields: [rentals.parkingPhotoId],
    references: [files.id],
  }),
  scooter: one(scooters, {
    fields: [rentals.scooterId],
    references: [scooters.id],
  }),
  tariff: one(tariffs, {
    fields: [rentals.tariffId],
    references: [tariffs.id],
  }),
  user: one(users, {
    fields: [rentals.userId],
    references: [users.id],
  }),
  walletLedgers: many(walletLedger),
  receipts: many(receipts),
  scooterZoneControls: many(scooterZoneControl),
  refunds: many(refunds),
  tickets: many(tickets),
  notifications: many(notifications),
  scooterZonePresences: many(scooterZonePresence),
}));

export const scootersRelations = relations(scooters, ({ one, many }) => ({
  scooterCommands: many(scooterCommands),
  scooterModel: one(scooterModels, {
    fields: [scooters.modelId],
    references: [scooterModels.id],
  }),
  rentals: many(rentals),
  serviceTasks: many(serviceTasks),
  scooterZoneControls: many(scooterZoneControl),
  tickets: many(tickets),
  scooterZonePresences: many(scooterZonePresence),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  staff: one(staff, {
    fields: [zones.updatedBy],
    references: [staff.id],
  }),
  rentalEvents: many(rentalEvents),
  rentals: many(rentals),
  serviceTasks: many(serviceTasks),
  scooterZonePresences: many(scooterZonePresence),
}));

export const scooterModelsRelations = relations(scooterModels, ({ one, many }) => ({
  scooters: many(scooters),
  mediaAsset: one(mediaAssets, {
    fields: [scooterModels.photoMediaId],
    references: [mediaAssets.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  paymentMethod: one(paymentMethods, {
    fields: [payments.paymentMethodId],
    references: [paymentMethods.id],
  }),
  rental: one(rentals, {
    fields: [payments.rentalId],
    references: [rentals.id],
  }),
  user: one(users, {
    fields: [payments.userId],
    references: [users.id],
  }),
  walletLedgers: many(walletLedger),
  receipts: many(receipts),
  refunds: many(refunds),
  paymentWebhookEvents: many(paymentWebhookEvents),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  payments: many(payments),
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
  rentals: many(rentals),
}));

export const rentalEventsRelations = relations(rentalEvents, ({ one }) => ({
  rental: one(rentals, {
    fields: [rentalEvents.rentalId],
    references: [rentals.id],
  }),
  zone: one(zones, {
    fields: [rentalEvents.zoneId],
    references: [zones.id],
  }),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
  walletLedgers: many(walletLedger),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  rentals: many(rentals),
  mediaAssets: many(mediaAssets),
  reportRuns: many(reportRuns),
  documentTemplateVersions_fileId: many(documentTemplateVersions, {
    relationName: 'documentTemplateVersions_fileId_files_id',
  }),
  documentTemplateVersions_previewFileId: many(documentTemplateVersions, {
    relationName: 'documentTemplateVersions_previewFileId_files_id',
  }),
  user: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  staff: one(staff, {
    fields: [files.uploadedByStaff],
    references: [staff.id],
  }),
  generatedDocuments_docxFileId: many(generatedDocuments, {
    relationName: 'generatedDocuments_docxFileId_files_id',
  }),
  generatedDocuments_pdfFileId: many(generatedDocuments, {
    relationName: 'generatedDocuments_pdfFileId_files_id',
  }),
  dataExports: many(dataExports),
  ticketPhotos: many(ticketPhotos),
}));

export const walletLedgerRelations = relations(walletLedger, ({ one }) => ({
  payment: one(payments, {
    fields: [walletLedger.paymentId],
    references: [payments.id],
  }),
  refund: one(refunds, {
    fields: [walletLedger.refundId],
    references: [refunds.id],
  }),
  rental: one(rentals, {
    fields: [walletLedger.rentalId],
    references: [rentals.id],
  }),
  staff: one(staff, {
    fields: [walletLedger.staffId],
    references: [staff.id],
  }),
  wallet: one(wallets, {
    fields: [walletLedger.userId],
    references: [wallets.userId],
  }),
}));

export const refundsRelations = relations(refunds, ({ one, many }) => ({
  walletLedgers: many(walletLedger),
  receipts: many(receipts),
  payment: one(payments, {
    fields: [refunds.paymentId],
    references: [payments.id],
  }),
  rental: one(rentals, {
    fields: [refunds.rentalId],
    references: [rentals.id],
  }),
  staff: one(staff, {
    fields: [refunds.staffId],
    references: [staff.id],
  }),
  ticket: one(tickets, {
    fields: [refunds.ticketId],
    references: [tickets.id],
  }),
  user: one(users, {
    fields: [refunds.userId],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  staff: one(staff, {
    fields: [auditLog.staffId],
    references: [staff.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one, many }) => ({
  file: one(files, {
    fields: [mediaAssets.fileId],
    references: [files.id],
  }),
  staff: one(staff, {
    fields: [mediaAssets.updatedBy],
    references: [staff.id],
  }),
  contentBlocks: many(contentBlocks),
  news: many(news),
  scooterModels: many(scooterModels),
}));

export const contentPagesRelations = relations(contentPages, ({ many }) => ({
  contentPageVersions: many(contentPageVersions),
}));

export const notificationTemplatesRelations = relations(notificationTemplates, ({ one, many }) => ({
  staff: one(staff, {
    fields: [notificationTemplates.updatedBy],
    references: [staff.id],
  }),
  notificationTemplateVersions: many(notificationTemplateVersions),
}));

export const contentBlocksRelations = relations(contentBlocks, ({ one }) => ({
  mediaAsset: one(mediaAssets, {
    fields: [contentBlocks.mediaId],
    references: [mediaAssets.id],
  }),
  staff: one(staff, {
    fields: [contentBlocks.updatedBy],
    references: [staff.id],
  }),
}));

export const faqItemsRelations = relations(faqItems, ({ one }) => ({
  faqCategory: one(faqCategories, {
    fields: [faqItems.categoryId],
    references: [faqCategories.id],
  }),
  staff: one(staff, {
    fields: [faqItems.updatedBy],
    references: [staff.id],
  }),
}));

export const faqCategoriesRelations = relations(faqCategories, ({ many }) => ({
  faqItems: many(faqItems),
}));

export const reportDefinitionsRelations = relations(reportDefinitions, ({ one, many }) => ({
  permission: one(permissions, {
    fields: [reportDefinitions.permissionCode],
    references: [permissions.code],
  }),
  staff: one(staff, {
    fields: [reportDefinitions.updatedBy],
    references: [staff.id],
  }),
  reportRuns: many(reportRuns),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  reportDefinitions: many(reportDefinitions),
  rolePermissions: many(rolePermissions),
}));

export const reportRunsRelations = relations(reportRuns, ({ one }) => ({
  file: one(files, {
    fields: [reportRuns.fileId],
    references: [files.id],
  }),
  reportDefinition: one(reportDefinitions, {
    fields: [reportRuns.reportCode],
    references: [reportDefinitions.code],
  }),
  staff: one(staff, {
    fields: [reportRuns.requestedBy],
    references: [staff.id],
  }),
}));

export const newsRelations = relations(news, ({ one }) => ({
  staff_createdBy: one(staff, {
    fields: [news.createdBy],
    references: [staff.id],
    relationName: 'news_createdBy_staff_id',
  }),
  mediaAsset: one(mediaAssets, {
    fields: [news.mediaId],
    references: [mediaAssets.id],
  }),
  staff_updatedBy: one(staff, {
    fields: [news.updatedBy],
    references: [staff.id],
    relationName: 'news_updatedBy_staff_id',
  }),
}));

export const documentTemplatesRelations = relations(documentTemplates, ({ one, many }) => ({
  staff_createdBy: one(staff, {
    fields: [documentTemplates.createdBy],
    references: [staff.id],
    relationName: 'documentTemplates_createdBy_staff_id',
  }),
  staff_updatedBy: one(staff, {
    fields: [documentTemplates.updatedBy],
    references: [staff.id],
    relationName: 'documentTemplates_updatedBy_staff_id',
  }),
  documentTemplateVersions: many(documentTemplateVersions),
}));

export const documentTemplateVersionsRelations = relations(documentTemplateVersions, ({ one, many }) => ({
  staff_activatedBy: one(staff, {
    fields: [documentTemplateVersions.activatedBy],
    references: [staff.id],
    relationName: 'documentTemplateVersions_activatedBy_staff_id',
  }),
  file_fileId: one(files, {
    fields: [documentTemplateVersions.fileId],
    references: [files.id],
    relationName: 'documentTemplateVersions_fileId_files_id',
  }),
  file_previewFileId: one(files, {
    fields: [documentTemplateVersions.previewFileId],
    references: [files.id],
    relationName: 'documentTemplateVersions_previewFileId_files_id',
  }),
  documentTemplate: one(documentTemplates, {
    fields: [documentTemplateVersions.templateId],
    references: [documentTemplates.id],
  }),
  staff_uploadedBy: one(staff, {
    fields: [documentTemplateVersions.uploadedBy],
    references: [staff.id],
    relationName: 'documentTemplateVersions_uploadedBy_staff_id',
  }),
  generatedDocuments: many(generatedDocuments),
}));

export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  receipt: one(receipts, {
    fields: [receipts.correctsReceiptId],
    references: [receipts.id],
    relationName: 'receipts_correctsReceiptId_receipts_id',
  }),
  receipts: many(receipts, {
    relationName: 'receipts_correctsReceiptId_receipts_id',
  }),
  payment: one(payments, {
    fields: [receipts.paymentId],
    references: [payments.id],
  }),
  refund: one(refunds, {
    fields: [receipts.refundId],
    references: [refunds.id],
  }),
  rental: one(rentals, {
    fields: [receipts.rentalId],
    references: [rentals.id],
  }),
  user: one(users, {
    fields: [receipts.userId],
    references: [users.id],
  }),
  receiptItems: many(receiptItems),
}));

export const serviceTasksRelations = relations(serviceTasks, ({ one, many }) => ({
  staff_assigneeId: one(staff, {
    fields: [serviceTasks.assigneeId],
    references: [staff.id],
    relationName: 'serviceTasks_assigneeId_staff_id',
  }),
  staff_cancelledBy: one(staff, {
    fields: [serviceTasks.cancelledBy],
    references: [staff.id],
    relationName: 'serviceTasks_cancelledBy_staff_id',
  }),
  staff_createdBy: one(staff, {
    fields: [serviceTasks.createdBy],
    references: [staff.id],
    relationName: 'serviceTasks_createdBy_staff_id',
  }),
  scooter: one(scooters, {
    fields: [serviceTasks.scooterId],
    references: [scooters.id],
  }),
  zone: one(zones, {
    fields: [serviceTasks.targetZoneId],
    references: [zones.id],
  }),
  ticket: one(tickets, {
    fields: [serviceTasks.ticketId],
    references: [tickets.id],
  }),
  sparePartMovements: many(sparePartMovements),
  serviceTaskParts: many(serviceTaskParts),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  serviceTasks: many(serviceTasks),
  refunds: many(refunds),
  staff: one(staff, {
    fields: [tickets.assigneeId],
    references: [staff.id],
  }),
  rental: one(rentals, {
    fields: [tickets.rentalId],
    references: [rentals.id],
  }),
  user: one(users, {
    fields: [tickets.reportedBy],
    references: [users.id],
  }),
  scooter: one(scooters, {
    fields: [tickets.scooterId],
    references: [scooters.id],
  }),
  notifications: many(notifications),
  ticketPhotos: many(ticketPhotos),
}));

export const staffSessionsRelations = relations(staffSessions, ({ one, many }) => ({
  staffSession: one(staffSessions, {
    fields: [staffSessions.replacedBy],
    references: [staffSessions.id],
    relationName: 'staffSessions_replacedBy_staffSessions_id',
  }),
  staffSessions: many(staffSessions, {
    relationName: 'staffSessions_replacedBy_staffSessions_id',
  }),
  staff: one(staff, {
    fields: [staffSessions.staffId],
    references: [staff.id],
  }),
}));

export const staffInvitationsRelations = relations(staffInvitations, ({ one }) => ({
  staff_invitedBy: one(staff, {
    fields: [staffInvitations.invitedBy],
    references: [staff.id],
    relationName: 'staffInvitations_invitedBy_staff_id',
  }),
  staff_staffId: one(staff, {
    fields: [staffInvitations.staffId],
    references: [staff.id],
    relationName: 'staffInvitations_staffId_staff_id',
  }),
}));

export const scooterZoneControlRelations = relations(scooterZoneControl, ({ one }) => ({
  scooterCommand_limitCommandId: one(scooterCommands, {
    fields: [scooterZoneControl.limitCommandId],
    references: [scooterCommands.id],
    relationName: 'scooterZoneControl_limitCommandId_scooterCommands_id',
  }),
  rental: one(rentals, {
    fields: [scooterZoneControl.rentalId],
    references: [rentals.id],
  }),
  scooter: one(scooters, {
    fields: [scooterZoneControl.scooterId],
    references: [scooters.id],
  }),
  scooterCommand_stopCommandId: one(scooterCommands, {
    fields: [scooterZoneControl.stopCommandId],
    references: [scooterCommands.id],
    relationName: 'scooterZoneControl_stopCommandId_scooterCommands_id',
  }),
}));

export const paymentWebhookEventsRelations = relations(paymentWebhookEvents, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentWebhookEvents.paymentId],
    references: [payments.id],
  }),
}));

export const sparePartMovementsRelations = relations(sparePartMovements, ({ one }) => ({
  sparePart: one(spareParts, {
    fields: [sparePartMovements.partId],
    references: [spareParts.id],
  }),
  staff: one(staff, {
    fields: [sparePartMovements.staffId],
    references: [staff.id],
  }),
  serviceTask: one(serviceTasks, {
    fields: [sparePartMovements.taskId],
    references: [serviceTasks.id],
  }),
}));

export const sparePartsRelations = relations(spareParts, ({ many }) => ({
  sparePartMovements: many(sparePartMovements),
  serviceTaskParts: many(serviceTaskParts),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  rental: one(rentals, {
    fields: [notifications.rentalId],
    references: [rentals.id],
  }),
  ticket: one(tickets, {
    fields: [notifications.ticketId],
    references: [tickets.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const notificationTemplateVersionsRelations = relations(notificationTemplateVersions, ({ one }) => ({
  staff: one(staff, {
    fields: [notificationTemplateVersions.staffId],
    references: [staff.id],
  }),
  notificationTemplate: one(notificationTemplates, {
    fields: [notificationTemplateVersions.templateId],
    references: [notificationTemplates.id],
  }),
}));

export const generatedDocumentsRelations = relations(generatedDocuments, ({ one, many }) => ({
  file_docxFileId: one(files, {
    fields: [generatedDocuments.docxFileId],
    references: [files.id],
    relationName: 'generatedDocuments_docxFileId_files_id',
  }),
  file_pdfFileId: one(files, {
    fields: [generatedDocuments.pdfFileId],
    references: [files.id],
    relationName: 'generatedDocuments_pdfFileId_files_id',
  }),
  staff: one(staff, {
    fields: [generatedDocuments.requestedByStaff],
    references: [staff.id],
  }),
  user: one(users, {
    fields: [generatedDocuments.requestedByUser],
    references: [users.id],
  }),
  generatedDocument: one(generatedDocuments, {
    fields: [generatedDocuments.retryOf],
    references: [generatedDocuments.id],
    relationName: 'generatedDocuments_retryOf_generatedDocuments_id',
  }),
  generatedDocuments: many(generatedDocuments, {
    relationName: 'generatedDocuments_retryOf_generatedDocuments_id',
  }),
  documentTemplateVersion: one(documentTemplateVersions, {
    fields: [generatedDocuments.templateVersionId],
    references: [documentTemplateVersions.id],
  }),
}));

export const companyProfileRelations = relations(companyProfile, ({ one }) => ({
  staff: one(staff, {
    fields: [companyProfile.updatedBy],
    references: [staff.id],
  }),
}));

export const dataExportsRelations = relations(dataExports, ({ one }) => ({
  file: one(files, {
    fields: [dataExports.fileId],
    references: [files.id],
  }),
  user: one(users, {
    fields: [dataExports.userId],
    references: [users.id],
  }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  permission: one(permissions, {
    fields: [rolePermissions.permissionCode],
    references: [permissions.code],
  }),
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  staffRoles: many(staffRoles),
}));

export const ticketPhotosRelations = relations(ticketPhotos, ({ one }) => ({
  file: one(files, {
    fields: [ticketPhotos.fileId],
    references: [files.id],
  }),
  ticket: one(tickets, {
    fields: [ticketPhotos.ticketId],
    references: [tickets.id],
  }),
}));

export const staffRolesRelations = relations(staffRoles, ({ one }) => ({
  staff_assignedBy: one(staff, {
    fields: [staffRoles.assignedBy],
    references: [staff.id],
    relationName: 'staffRoles_assignedBy_staff_id',
  }),
  role: one(roles, {
    fields: [staffRoles.roleId],
    references: [roles.id],
  }),
  staff_staffId: one(staff, {
    fields: [staffRoles.staffId],
    references: [staff.id],
    relationName: 'staffRoles_staffId_staff_id',
  }),
}));

export const serviceTaskPartsRelations = relations(serviceTaskParts, ({ one }) => ({
  sparePart: one(spareParts, {
    fields: [serviceTaskParts.partId],
    references: [spareParts.id],
  }),
  serviceTask: one(serviceTasks, {
    fields: [serviceTaskParts.taskId],
    references: [serviceTasks.id],
  }),
}));

export const paymentCustomersRelations = relations(paymentCustomers, ({ one }) => ({
  user: one(users, {
    fields: [paymentCustomers.userId],
    references: [users.id],
  }),
}));

export const scooterZonePresenceRelations = relations(scooterZonePresence, ({ one }) => ({
  rental: one(rentals, {
    fields: [scooterZonePresence.rentalId],
    references: [rentals.id],
  }),
  scooter: one(scooters, {
    fields: [scooterZonePresence.scooterId],
    references: [scooters.id],
  }),
  zone: one(zones, {
    fields: [scooterZonePresence.zoneId],
    references: [zones.id],
  }),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, {
    fields: [receiptItems.receiptId],
    references: [receipts.id],
  }),
}));
