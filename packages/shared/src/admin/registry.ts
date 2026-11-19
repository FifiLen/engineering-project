/**
 * Rejestr zasobów wzorca widoku tabeli (ADR 0031, ADR 0076): 32 zasoby z iteracji 1–7 i 15 nowych list z iteracji 8.
 * Eksport list (ADR 0073) i testy sprawdzają nim, że każdy zasób ma unikalną nazwę i poprawne pola. Telemetria
 * ma osobny kontrakt z kursorem (`telemetryReadingsQuerySchema`) i nie jest w rejestrze.
 */
import { auditLogResource, rolesResource, staffResource, usersResource } from './access.js';
import {
  consentsResource,
  otpCodesResource,
  permissionsResource,
  savedPlacesResource,
  sessionsResource,
  staffInvitationsResource,
  staffSessionsResource,
} from './accounts.js';
import {
  contentBlocksResource,
  faqCategoriesResource,
  faqItemsResource,
  mediaResource,
  newsResource,
} from './content.js';
import { dataExportsResource, documentTemplatesResource, generatedDocumentsResource } from './documents.js';
import { scooterModelsResource, scootersResource } from './fleet.js';
import type { ResourceDefinition } from './list.js';
import { notificationsResource, notificationTemplatesResource, pushTokensResource } from './notifications.js';
import {
  filesResource,
  serviceTasksResource,
  sparePartMovementsResource,
  sparePartsResource,
  ticketsResource,
} from './operations.js';
import {
  paymentMethodsResource,
  paymentsResource,
  receiptsResource,
  refundsResource,
  tariffsResource,
  walletLedgerResource,
  walletsResource,
  webhookEventsResource,
} from './payments.js';
import { rentalsResource } from './rentals.js';
import { reportDefinitionsResource, reportRunsResource } from './reports.js';
import {
  paymentCustomersResource,
  rentalEventsResource,
  scooterCommandsResource,
  scooterStatusHistoryResource,
  zoneControlResource,
  zonePresenceResource,
} from './system-lists.js';
import { zonesResource } from './zones.js';

export const ADMIN_RESOURCES: readonly ResourceDefinition[] = [
  scootersResource,
  scooterModelsResource,
  staffResource,
  rolesResource,
  usersResource,
  auditLogResource,
  rentalsResource,
  zonesResource,
  tariffsResource,
  paymentsResource,
  walletLedgerResource,
  walletsResource,
  receiptsResource,
  paymentMethodsResource,
  webhookEventsResource,
  refundsResource,
  ticketsResource,
  serviceTasksResource,
  sparePartsResource,
  sparePartMovementsResource,
  filesResource,
  notificationTemplatesResource,
  notificationsResource,
  pushTokensResource,
  contentBlocksResource,
  faqItemsResource,
  faqCategoriesResource,
  newsResource,
  mediaResource,
  documentTemplatesResource,
  generatedDocumentsResource,
  dataExportsResource,
  // Iteracja 8 (ADR 0071, ADR 0074, ADR 0076).
  consentsResource,
  sessionsResource,
  staffSessionsResource,
  staffInvitationsResource,
  otpCodesResource,
  scooterCommandsResource,
  rentalEventsResource,
  zonePresenceResource,
  zoneControlResource,
  paymentCustomersResource,
  permissionsResource,
  savedPlacesResource,
  scooterStatusHistoryResource,
  reportRunsResource,
  reportDefinitionsResource,
];

/** Zasób po nazwie z adresu (`/admin/<name>`), np. do wspólnego punktu eksportu. */
export const adminResource = (name: string): ResourceDefinition | undefined =>
  ADMIN_RESOURCES.find((resource) => resource.name === name);
