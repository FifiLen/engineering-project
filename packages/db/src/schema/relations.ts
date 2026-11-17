import { relations } from 'drizzle-orm/relations';
import {
  users,
  pushTokens,
  savedPlaces,
  contentPageVersions,
  consents,
  staff,
  tariffs,
  sessions,
  scooterCommands,
  rentals,
  scooters,
  zones,
  scooterModels,
  rentalEvents,
  wallets,
  files,
  paymentMethods,
  payments,
  walletLedger,
  tickets,
  notifications,
  auditLog,
  contentPages,
  mediaAssets,
  contentBlocks,
  faqItems,
  news,
  notificationTemplates,
  permissions,
  reportDefinitions,
  reportRuns,
  documentTemplates,
  documentTemplateVersions,
  generatedDocuments,
  serviceTasks,
  receipts,
  staffSessions,
  staffInvitations,
  ticketPhotos,
  rolePermissions,
  roles,
  staffRoles,
  spareParts,
  serviceTaskParts,
  receiptItems,
} from './schema.js';

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  pushTokens: many(pushTokens),
  savedPlaces: many(savedPlaces),
  consents: many(consents),
  sessions: many(sessions),
  wallets: many(wallets),
  rentals: many(rentals),
  paymentMethods: many(paymentMethods),
  payments: many(payments),
  tickets: many(tickets),
  notifications: many(notifications),
  files: many(files),
  generatedDocuments: many(generatedDocuments),
  receipts: many(receipts),
}));

export const savedPlacesRelations = relations(savedPlaces, ({ one }) => ({
  user: one(users, {
    fields: [savedPlaces.userId],
    references: [users.id],
  }),
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
  tickets: many(tickets),
  files: many(files),
  auditLogs: many(auditLog),
  contentPageVersions: many(contentPageVersions),
  mediaAssets: many(mediaAssets),
  contentBlocks: many(contentBlocks),
  faqItems: many(faqItems),
  news_createdBy: many(news, {
    relationName: 'news_createdBy_staff_id',
  }),
  news_updatedBy: many(news, {
    relationName: 'news_updatedBy_staff_id',
  }),
  notificationTemplates: many(notificationTemplates),
  reportDefinitions: many(reportDefinitions),
  reportRuns: many(reportRuns),
  documentTemplates_createdBy: many(documentTemplates, {
    relationName: 'documentTemplates_createdBy_staff_id',
  }),
  documentTemplates_updatedBy: many(documentTemplates, {
    relationName: 'documentTemplates_updatedBy_staff_id',
  }),
  documentTemplateVersions: many(documentTemplateVersions),
  generatedDocuments: many(generatedDocuments),
  serviceTasks_assigneeId: many(serviceTasks, {
    relationName: 'serviceTasks_assigneeId_staff_id',
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
}));

export const scooterCommandsRelations = relations(scooterCommands, ({ one }) => ({
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
}));

export const rentalsRelations = relations(rentals, ({ one, many }) => ({
  scooterCommands: many(scooterCommands),
  rentalEvents: many(rentalEvents),
  zone: one(zones, {
    fields: [rentals.endZoneId],
    references: [zones.id],
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
  payments: many(payments),
  walletLedgers: many(walletLedger),
  tickets: many(tickets),
  receipts: many(receipts),
}));

export const scootersRelations = relations(scooters, ({ one, many }) => ({
  scooterCommands: many(scooterCommands),
  scooterModel: one(scooterModels, {
    fields: [scooters.modelId],
    references: [scooterModels.id],
  }),
  rentals: many(rentals),
  tickets: many(tickets),
  serviceTasks: many(serviceTasks),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  staff: one(staff, {
    fields: [zones.updatedBy],
    references: [staff.id],
  }),
  rentalEvents: many(rentalEvents),
  rentals: many(rentals),
}));

export const scooterModelsRelations = relations(scooterModels, ({ one, many }) => ({
  scooters: many(scooters),
  mediaAsset: one(mediaAssets, {
    fields: [scooterModels.photoMediaId],
    references: [mediaAssets.id],
  }),
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
  user: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  staff: one(staff, {
    fields: [files.uploadedByStaff],
    references: [staff.id],
  }),
  mediaAssets: many(mediaAssets),
  reportRuns: many(reportRuns),
  documentTemplateVersions: many(documentTemplateVersions),
  generatedDocuments_docxFileId: many(generatedDocuments, {
    relationName: 'generatedDocuments_docxFileId_files_id',
  }),
  generatedDocuments_pdfFileId: many(generatedDocuments, {
    relationName: 'generatedDocuments_pdfFileId_files_id',
  }),
  ticketPhotos: many(ticketPhotos),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
  payments: many(payments),
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
}));

export const walletLedgerRelations = relations(walletLedger, ({ one }) => ({
  payment: one(payments, {
    fields: [walletLedger.paymentId],
    references: [payments.id],
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

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
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
  serviceTasks: many(serviceTasks),
  ticketPhotos: many(ticketPhotos),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  staff: one(staff, {
    fields: [auditLog.staffId],
    references: [staff.id],
  }),
}));

export const contentPagesRelations = relations(contentPages, ({ many }) => ({
  contentPageVersions: many(contentPageVersions),
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
  staff: one(staff, {
    fields: [faqItems.updatedBy],
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

export const notificationTemplatesRelations = relations(notificationTemplates, ({ one }) => ({
  staff: one(staff, {
    fields: [notificationTemplates.updatedBy],
    references: [staff.id],
  }),
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
  file: one(files, {
    fields: [documentTemplateVersions.fileId],
    references: [files.id],
  }),
  documentTemplate: one(documentTemplates, {
    fields: [documentTemplateVersions.templateId],
    references: [documentTemplates.id],
  }),
  staff: one(staff, {
    fields: [documentTemplateVersions.uploadedBy],
    references: [staff.id],
  }),
  generatedDocuments: many(generatedDocuments),
}));

export const generatedDocumentsRelations = relations(generatedDocuments, ({ one }) => ({
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
  documentTemplateVersion: one(documentTemplateVersions, {
    fields: [generatedDocuments.templateVersionId],
    references: [documentTemplateVersions.id],
  }),
}));

export const serviceTasksRelations = relations(serviceTasks, ({ one, many }) => ({
  staff_assigneeId: one(staff, {
    fields: [serviceTasks.assigneeId],
    references: [staff.id],
    relationName: 'serviceTasks_assigneeId_staff_id',
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
  ticket: one(tickets, {
    fields: [serviceTasks.ticketId],
    references: [tickets.id],
  }),
  serviceTaskParts: many(serviceTaskParts),
}));

export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  payment: one(payments, {
    fields: [receipts.paymentId],
    references: [payments.id],
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

export const sparePartsRelations = relations(spareParts, ({ many }) => ({
  serviceTaskParts: many(serviceTaskParts),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, {
    fields: [receiptItems.receiptId],
    references: [receipts.id],
  }),
}));
