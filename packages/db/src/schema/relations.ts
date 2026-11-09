import { relations } from 'drizzle-orm/relations';
import {
  users,
  consents,
  sessions,
  pushTokens,
  savedPlaces,
  staff,
  tariffs,
  scooters,
  scooterCommands,
  rentals,
  zones,
  files,
  rentalEvents,
  wallets,
  paymentMethods,
  payments,
  walletLedger,
  tickets,
  notifications,
  auditLog,
  ticketPhotos,
} from './schema.js';

export const consentsRelations = relations(consents, ({ one }) => ({
  user: one(users, {
    fields: [consents.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  consents: many(consents),
  sessions: many(sessions),
  pushTokens: many(pushTokens),
  savedPlaces: many(savedPlaces),
  rentals: many(rentals),
  wallets: many(wallets),
  paymentMethods: many(paymentMethods),
  payments: many(payments),
  files: many(files),
  tickets: many(tickets),
  notifications: many(notifications),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

export const savedPlacesRelations = relations(savedPlaces, ({ one }) => ({
  user: one(users, {
    fields: [savedPlaces.userId],
    references: [users.id],
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
  auditLogs: many(auditLog),
}));

export const scooterCommandsRelations = relations(scooterCommands, ({ one }) => ({
  scooter: one(scooters, {
    fields: [scooterCommands.scooterId],
    references: [scooters.id],
  }),
  staff: one(staff, {
    fields: [scooterCommands.issuedByStaff],
    references: [staff.id],
  }),
  rental: one(rentals, {
    fields: [scooterCommands.rentalId],
    references: [rentals.id],
  }),
}));

export const scootersRelations = relations(scooters, ({ many }) => ({
  scooterCommands: many(scooterCommands),
  rentals: many(rentals),
  tickets: many(tickets),
}));

export const rentalsRelations = relations(rentals, ({ one, many }) => ({
  scooterCommands: many(scooterCommands),
  user: one(users, {
    fields: [rentals.userId],
    references: [users.id],
  }),
  scooter: one(scooters, {
    fields: [rentals.scooterId],
    references: [scooters.id],
  }),
  tariff: one(tariffs, {
    fields: [rentals.tariffId],
    references: [tariffs.id],
  }),
  zone: one(zones, {
    fields: [rentals.endZoneId],
    references: [zones.id],
  }),
  file: one(files, {
    fields: [rentals.parkingPhotoId],
    references: [files.id],
  }),
  rentalEvents: many(rentalEvents),
  payments: many(payments),
  walletLedgers: many(walletLedger),
  tickets: many(tickets),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  staff: one(staff, {
    fields: [zones.updatedBy],
    references: [staff.id],
  }),
  rentals: many(rentals),
  rentalEvents: many(rentalEvents),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  rentals: many(rentals),
  user: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  ticketPhotos: many(ticketPhotos),
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

export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  user: one(users, {
    fields: [payments.userId],
    references: [users.id],
  }),
  rental: one(rentals, {
    fields: [payments.rentalId],
    references: [rentals.id],
  }),
  paymentMethod: one(paymentMethods, {
    fields: [payments.paymentMethodId],
    references: [paymentMethods.id],
  }),
  walletLedgers: many(walletLedger),
}));

export const walletLedgerRelations = relations(walletLedger, ({ one }) => ({
  wallet: one(wallets, {
    fields: [walletLedger.userId],
    references: [wallets.userId],
  }),
  rental: one(rentals, {
    fields: [walletLedger.rentalId],
    references: [rentals.id],
  }),
  payment: one(payments, {
    fields: [walletLedger.paymentId],
    references: [payments.id],
  }),
  staff: one(staff, {
    fields: [walletLedger.staffId],
    references: [staff.id],
  }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  scooter: one(scooters, {
    fields: [tickets.scooterId],
    references: [scooters.id],
  }),
  rental: one(rentals, {
    fields: [tickets.rentalId],
    references: [rentals.id],
  }),
  user: one(users, {
    fields: [tickets.reportedBy],
    references: [users.id],
  }),
  staff: one(staff, {
    fields: [tickets.assigneeId],
    references: [staff.id],
  }),
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

export const ticketPhotosRelations = relations(ticketPhotos, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketPhotos.ticketId],
    references: [tickets.id],
  }),
  file: one(files, {
    fields: [ticketPhotos.fileId],
    references: [files.id],
  }),
}));
