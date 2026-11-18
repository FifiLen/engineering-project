// Plik generowany przez `pnpm db:pull` na podstawie bazy. Nie edytuj ręcznie.
import {
  pgTable,
  index,
  uuid,
  text,
  smallint,
  timestamp,
  unique,
  check,
  integer,
  boolean,
  foreignKey,
  geometry,
  uniqueIndex,
  bigint,
  numeric,
  jsonb,
  char,
  primaryKey,
  pgView,
  interval,
  date,
  doublePrecision,
  pgSequence,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const auditActor = pgEnum('audit_actor', ['STAFF', 'SYSTEM']);
export const blockReason = pgEnum('block_reason', ['TERMS_VIOLATION', 'UNPAID_BALANCE', 'SUSPECTED_ABUSE']);
export const commandStatus = pgEnum('command_status', ['SENT', 'ACKED', 'REJECTED', 'TIMEOUT']);
export const commandType = pgEnum('command_type', [
  'UNLOCK',
  'LOCK',
  'SPEED_LIMIT',
  'STOP_GRADUALLY',
  'RING',
  'LIGHTS',
  'RELEASE_STOP',
  'BATTERY_SWAPPED',
]);
export const consentType = pgEnum('consent_type', ['TERMS', 'PRIVACY', 'MARKETING', 'AGE']);
export const contentClient = pgEnum('content_client', ['WEB', 'MOBILE', 'ADMIN']);
export const contentStatus = pgEnum('content_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const documentType = pgEnum('document_type', [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
]);
export const filePurpose = pgEnum('file_purpose', [
  'PARKING_PHOTO',
  'TICKET_PHOTO',
  'MEDIA',
  'DOCUMENT_TEMPLATE',
  'GENERATED_DOCUMENT',
  'REPORT_EXPORT',
]);
export const fileStatus = pgEnum('file_status', ['READY', 'DELETED']);
export const jobStatus = pgEnum('job_status', ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'TOPUP',
  'RIDE_CHARGE',
  'REFUND',
  'ADJUSTMENT',
  'PAYOUT',
  'TOWING_FEE',
]);
export const ledgerReason = pgEnum('ledger_reason', ['COMPLAINT', 'SYSTEM_ERROR', 'GOODWILL', 'OTHER']);
export const notificationChannel = pgEnum('notification_channel', ['PUSH', 'SMS']);
export const notificationStatus = pgEnum('notification_status', ['QUEUED', 'SENT', 'FAILED', 'SKIPPED']);
export const partAdjustReason = pgEnum('part_adjust_reason', ['STOCKTAKE', 'DAMAGED', 'LOST', 'OTHER']);
export const partMovementKind = pgEnum('part_movement_kind', ['RECEIPT', 'ADJUSTMENT', 'USE', 'RETURN']);
export const paymentMethodKind = pgEnum('payment_method_kind', ['CARD', 'BLIK']);
export const paymentPurpose = pgEnum('payment_purpose', ['TOPUP', 'RIDE']);
export const paymentSource = pgEnum('payment_source', ['WALLET', 'CARD']);
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export const placeLabel = pgEnum('place_label', ['HOME', 'WORK', 'CUSTOM']);
export const platform = pgEnum('platform', ['IOS', 'ANDROID']);
export const receiptKind = pgEnum('receipt_kind', ['SALE', 'CORRECTION']);
export const refundReason = pgEnum('refund_reason', [
  'SCOOTER_FAILURE',
  'BILLING_ERROR',
  'CUSTOMER_COMPLAINT',
  'OTHER',
  'BALANCE_PAYOUT',
]);
export const refundStatus = pgEnum('refund_status', ['PENDING', 'SUCCEEDED', 'FAILED']);
export const rentalEndMode = pgEnum('rental_end_mode', ['CUSTOMER', 'CUSTOMER_OFFLINE', 'REMOTE', 'UNCONFIRMED']);
export const rentalEventType = pgEnum('rental_event_type', [
  'STATE_CHANGED',
  'ZONE_ENTERED',
  'ZONE_EXITED',
  'BATTERY_LOW',
  'CONNECTION_LOST',
  'CONNECTION_RESTORED',
  'PHOTO_UPLOADED',
  'END_REQUESTED',
  'PAUSE_FAILED',
  'RESUME_FAILED',
  'LOCK_FAILED',
  'ENDED_REMOTELY',
  'LATE_UNLOCK_LOCKED',
  'BILLING_STOPPED',
  'MOVED_AFTER_END',
]);
export const rentalState = pgEnum('rental_state', [
  'RESERVED',
  'UNLOCKING',
  'ACTIVE',
  'PAUSED',
  'ENDING',
  'ENDED',
  'EXPIRED',
  'UNLOCK_FAILED',
  'UNPAID',
]);
export const reportFormat = pgEnum('report_format', ['PDF', 'XLSX', 'CSV']);
export const scooterStatus = pgEnum('scooter_status', ['AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED']);
export const scooterStatusReason = pgEnum('scooter_status_reason', [
  'URGENT_TICKET',
  'SERVICE_TASK',
  'BATTERY_BELOW_THRESHOLD',
  'OFFLINE',
  'THEFT',
  'DAMAGE',
  'END_OF_LIFE',
  'OTHER',
]);
export const scooterVariant = pgEnum('scooter_variant', ['GRAFIT', 'BETON', 'KOBALT']);
export const serviceTaskStatus = pgEnum('service_task_status', ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const serviceTaskType = pgEnum('service_task_type', ['REPAIR', 'BATTERY_SWAP', 'INSPECTION', 'RELOCATION']);
export const taskPriority = pgEnum('task_priority', ['LOW', 'NORMAL', 'HIGH']);
export const ticketAutoKind = pgEnum('ticket_auto_kind', ['OFFLINE', 'BATTERY_CRITICAL', 'OUT_OF_ZONE']);
export const ticketCategory = pgEnum('ticket_category', [
  'BRAKES',
  'LIGHTS',
  'WHEEL',
  'HANDLEBAR',
  'QR_CODE',
  'BATTERY',
  'CONNECTION',
  'OTHER',
  'BILLING',
  'OUT_OF_ZONE',
]);
export const ticketSource = pgEnum('ticket_source', ['USER', 'AUTO', 'STAFF']);
export const ticketStatus = pgEnum('ticket_status', ['NEW', 'IN_PROGRESS', 'AT_SERVICE', 'RESOLVED']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'BLOCKED', 'DELETED']);
export const zoneType = pgEnum('zone_type', ['SERVICE_AREA', 'PARKING', 'SLOW', 'NO_RIDE']);

export const rentalNumberSeq = pgSequence('rental_number_seq', {
  startWith: '50000',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});
export const contentRevisionSeq = pgSequence('content_revision_seq', {
  startWith: '1',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});
export const serviceTaskNumberSeq = pgSequence('service_task_number_seq', {
  startWith: '1000',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});
export const receiptNumberSeq = pgSequence('receipt_number_seq', {
  startWith: '1',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});
export const ticketNumberSeq = pgSequence('ticket_number_seq', {
  startWith: '1000',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    phone: text().notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint().default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('otp_codes_phone_idx').using(
      'btree',
      table.phone.asc().nullsLast().op('text_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    phone: text(),
    email: text(),
    name: text(),
    status: userStatus().default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true, mode: 'date' }),
    blockedReason: blockReason('blocked_reason'),
    notifyReservationEnd: boolean('notify_reservation_end').default(true).notNull(),
    notifyReceipts: boolean('notify_receipts').default(true).notNull(),
  },
  (table) => [
    unique('users_phone_key').on(table.phone),
    unique('users_email_key').on(table.email),
    check(
      'users_block_consistent',
      sql`((status = 'BLOCKED'::user_status) = (blocked_at IS NOT NULL)) AND ((blocked_at IS NULL) = (blocked_reason IS NULL))`,
    ),
    check('users_check', sql`(status <> 'DELETED'::user_status) OR ((phone IS NULL) AND (email IS NULL))`),
  ],
);

export const savedPlaces = pgTable(
  'saved_places',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    label: placeLabel().notNull(),
    name: text().notNull(),
    position: geometry({ type: 'point', srid: 4326 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'saved_places_user_id_fkey',
    }),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    type: consentType().notNull(),
    documentVersion: text('document_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    pageVersionId: uuid('page_version_id'),
  },
  (table) => [
    uniqueIndex('consents_one_active_per_version')
      .using(
        'btree',
        table.userId.asc().nullsLast().op('uuid_ops'),
        table.type.asc().nullsLast().op('enum_ops'),
        table.documentVersion.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(revoked_at IS NULL)`),
    index('consents_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.type.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.pageVersionId],
      foreignColumns: [contentPageVersions.id],
      name: 'consents_page_version_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'consents_user_id_fkey',
    }),
  ],
);

export const tariffs = pgTable(
  'tariffs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    version: integer().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unlockFee: bigint('unlock_fee', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    minuteRate: bigint('minute_rate', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    pauseMinuteRate: bigint('pause_minute_rate', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    outOfZoneFee: bigint('out_of_zone_fee', { mode: 'number' }).notNull(),
    freeReservationMinutes: smallint('free_reservation_minutes').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    minWalletBalance: bigint('min_wallet_balance', { mode: 'number' }).notNull(),
    minBatteryPct: smallint('min_battery_pct').notNull(),
    minUserAge: smallint('min_user_age').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    vatRate: numeric('vat_rate', { precision: 4, scale: 2 }).default('23.00').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'tariffs_created_by_fkey',
    }),
    unique('tariffs_version_key').on(table.version),
    check('tariffs_free_reservation_range', sql`(free_reservation_minutes >= 0) AND (free_reservation_minutes <= 60)`),
    check('tariffs_min_battery_pct_check', sql`(min_battery_pct >= 0) AND (min_battery_pct <= 100)`),
    check('tariffs_min_user_age_range', sql`(min_user_age >= 13) AND (min_user_age <= 99)`),
    check('tariffs_min_wallet_balance_check', sql`min_wallet_balance >= 0`),
    check('tariffs_minute_rate_check', sql`minute_rate >= 0`),
    check('tariffs_out_of_zone_fee_check', sql`out_of_zone_fee >= 0`),
    check('tariffs_pause_minute_rate_check', sql`pause_minute_rate >= 0`),
    check('tariffs_unlock_fee_check', sql`unlock_fee >= 0`),
    check('tariffs_vat_rate_check', sql`(vat_rate >= (0)::numeric) AND (vat_rate <= 99.99)`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceName: text('device_name'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    familyId: uuid('family_id').defaultRandom().notNull(),
    replacedBy: uuid('replaced_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sessions_family_idx').using('btree', table.familyId.asc().nullsLast().op('uuid_ops')),
    index('sessions_user_active_idx')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(revoked_at IS NULL)`),
    index('sessions_user_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.replacedBy],
      foreignColumns: [table.id],
      name: 'sessions_replaced_by_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }),
    unique('sessions_refresh_token_hash_key').on(table.refreshTokenHash),
    check('sessions_replaced_is_revoked', sql`(replaced_by IS NULL) OR (revoked_at IS NOT NULL)`),
  ],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    expoToken: text('expo_token').notNull(),
    platform: platform().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    sessionId: uuid('session_id'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('push_tokens_session_idx')
      .using('btree', table.sessionId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(session_id IS NOT NULL)`),
    index('push_tokens_user_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: 'push_tokens_session_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'push_tokens_user_id_fkey',
    }),
    unique('push_tokens_expo_token_key').on(table.expoToken),
  ],
);

export const scooterCommands = pgTable(
  'scooter_commands',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    scooterId: uuid('scooter_id').notNull(),
    rentalId: uuid('rental_id'),
    type: commandType().notNull(),
    payload: jsonb().default({}).notNull(),
    status: commandStatus().default('SENT').notNull(),
    issuedByStaff: uuid('issued_by_staff'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    ackedAt: timestamp('acked_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    ackReason: text('ack_reason'),
  },
  (table) => [
    uniqueIndex('scooter_commands_one_pending_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(
        sql`((status = 'SENT'::command_status) AND (rental_id IS NOT NULL) AND (type = ANY (ARRAY['LOCK'::command_type, 'UNLOCK'::command_type])))`,
      ),
    index('scooter_commands_pending_expiry_idx')
      .using('btree', table.expiresAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'SENT'::command_status)`),
    index('scooter_commands_pending_idx')
      .using('btree', table.sentAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'SENT'::command_status)`),
    index('scooter_commands_rental_idx')
      .using(
        'btree',
        table.rentalId.asc().nullsLast().op('uuid_ops'),
        table.sentAt.asc().nullsLast().op('timestamptz_ops'),
      )
      .where(sql`(rental_id IS NOT NULL)`),
    index('scooter_commands_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('timestamptz_ops'),
      table.sentAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.issuedByStaff],
      foreignColumns: [staff.id],
      name: 'scooter_commands_issued_by_staff_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'scooter_commands_rental_fk',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'scooter_commands_scooter_id_fkey',
    }),
    check('scooter_commands_expiry_after_sent', sql`(expires_at IS NULL) OR (expires_at > sent_at)`),
  ],
);

export const zones = pgTable(
  'zones',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    type: zoneType().notNull(),
    geom: geometry({ type: 'multipolygon', srid: 4326 }).notNull(),
    speedLimitKmh: smallint('speed_limit_kmh'),
    capacity: smallint(),
    visibleInApp: boolean('visible_in_app').default(true).notNull(),
    active: boolean().default(true).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    index('zones_geom_gix')
      .using('gist', table.geom.asc().nullsLast().op('gist_geometry_ops_2d'))
      .where(sql`active`),
    uniqueIndex('zones_one_active_service_area')
      .using('btree', table.type.asc().nullsLast().op('enum_ops'))
      .where(sql`(active AND (type = 'SERVICE_AREA'::zone_type))`),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'zones_updated_by_fkey',
    }),
    unique('zones_code_key').on(table.code),
    check('zones_check', sql`(type <> 'SLOW'::zone_type) OR (speed_limit_kmh IS NOT NULL)`),
    check('zones_check1', sql`(type = 'PARKING'::zone_type) OR (capacity IS NULL)`),
    check('zones_geom_check', sql`CHECK (st_isvalid(geom`),
    check('zones_speed_limit_only_slow', sql`(type = 'SLOW'::zone_type) OR (speed_limit_kmh IS NULL)`),
  ],
);

export const scooters = pgTable(
  'scooters',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    number: integer().notNull(),
    serialNumber: text('serial_number').notNull(),
    variant: scooterVariant().notNull(),
    status: scooterStatus().default('AVAILABLE').notNull(),
    online: boolean().default(false).notNull(),
    batteryPct: smallint('battery_pct'),
    position: geometry({ type: 'point', srid: 4326 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    firmware: text(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    odometerM: bigint('odometer_m', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    modelId: uuid('model_id').notNull(),
    statusReason: scooterStatusReason('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('scooters_last_seen_idx').using('btree', table.lastSeenAt.desc().nullsLast().op('timestamptz_ops')),
    index('scooters_model_idx').using('btree', table.modelId.asc().nullsLast().op('uuid_ops')),
    index('scooters_position_gix').using('gist', table.position.asc().nullsLast().op('gist_geometry_ops_2d')),
    index('scooters_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    foreignKey({
      columns: [table.modelId],
      foreignColumns: [scooterModels.id],
      name: 'scooters_model_id_fkey',
    }),
    unique('scooters_number_key').on(table.number),
    unique('scooters_serial_number_key').on(table.serialNumber),
    check('scooters_battery_pct_check', sql`(battery_pct >= 0) AND (battery_pct <= 100)`),
    check(
      'scooters_status_reason_matches',
      sql`(status_reason IS NULL) OR ((status = 'MAINTENANCE'::scooter_status) AND (status_reason = ANY (ARRAY['URGENT_TICKET'::scooter_status_reason, 'SERVICE_TASK'::scooter_status_reason, 'BATTERY_BELOW_THRESHOLD'::scooter_status_reason, 'OFFLINE'::scooter_status_reason, 'OTHER'::scooter_status_reason]))) OR ((status = 'RETIRED'::scooter_status) AND (status_reason = ANY (ARRAY['THEFT'::scooter_status_reason, 'DAMAGE'::scooter_status_reason, 'END_OF_LIFE'::scooter_status_reason, 'OTHER'::scooter_status_reason])))`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    purpose: paymentPurpose().notNull(),
    rentalId: uuid('rental_id'),
    method: paymentMethodKind().notNull(),
    paymentMethodId: uuid('payment_method_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).default('PLN').notNull(),
    status: paymentStatus().default('PENDING').notNull(),
    providerPaymentId: text('provider_payment_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    provider: text().default('fake').notNull(),
    failureCode: text('failure_code'),
  },
  (table) => [
    uniqueIndex('payments_one_pending_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`((purpose = 'RIDE'::payment_purpose) AND (status = 'PENDING'::payment_status))`),
    index('payments_pending_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'PENDING'::payment_status)`),
    index('payments_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('payments_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.paymentMethodId],
      foreignColumns: [paymentMethods.id],
      name: 'payments_payment_method_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'payments_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'payments_user_id_fkey',
    }),
    unique('payments_provider_payment_id_key').on(table.providerPaymentId),
    unique('payments_idempotency_key_key').on(table.idempotencyKey),
    check('payments_amount_check', sql`amount > 0`),
    check('payments_check', sql`(purpose <> 'RIDE'::payment_purpose) OR (rental_id IS NOT NULL)`),
    check('payments_provider_check', sql`provider = ANY (ARRAY['fake'::text, 'stripe'::text])`),
  ],
);

export const rentalEvents = pgTable(
  'rental_events',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'rental_events_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    rentalId: uuid('rental_id').notNull(),
    type: rentalEventType().notNull(),
    fromState: rentalState('from_state'),
    toState: rentalState('to_state'),
    zoneId: uuid('zone_id'),
    data: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('rental_events_rental_idx').using(
      'btree',
      table.rentalId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'rental_events_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.zoneId],
      foreignColumns: [zones.id],
      name: 'rental_events_zone_id_fkey',
    }),
  ],
);

export const wallets = pgTable(
  'wallets',
  {
    userId: uuid('user_id').primaryKey().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    balance: bigint({ mode: 'number' }).default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'wallets_user_id_fkey',
    }),
  ],
);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    providerRef: text('provider_ref').notNull(),
    brand: text().notNull(),
    last4: char({ length: 4 }).notNull(),
    expMonth: smallint('exp_month').notNull(),
    expYear: smallint('exp_year').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    provider: text().default('fake').notNull(),
  },
  (table) => [
    uniqueIndex('payment_methods_one_default')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(is_default AND (removed_at IS NULL))`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'payment_methods_user_id_fkey',
    }),
    unique('payment_methods_provider_ref_key').on(table.providerRef),
    check('payment_methods_provider_check', sql`provider = ANY (ARRAY['fake'::text, 'stripe'::text])`),
  ],
);

export const rentals = pgTable(
  'rentals',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    number: bigint({ mode: 'number' })
      .default(sql`nextval('rental_number_seq'::regclass)`)
      .notNull(),
    userId: uuid('user_id').notNull(),
    scooterId: uuid('scooter_id').notNull(),
    tariffId: uuid('tariff_id').notNull(),
    state: rentalState().notNull(),
    paymentSource: paymentSource('payment_source').default('WALLET').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'date' }),
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    rideSeconds: integer('ride_seconds').default(0).notNull(),
    pauseSeconds: integer('pause_seconds').default(0).notNull(),
    distanceM: integer('distance_m').default(0).notNull(),
    startPosition: geometry('start_position', { type: 'point', srid: 4326 }),
    endPosition: geometry('end_position', { type: 'point', srid: 4326 }),
    endZoneId: uuid('end_zone_id'),
    route: geometry({ type: 'linestring', srid: 4326 }),
    parkingPhotoId: uuid('parking_photo_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    totalAmount: bigint('total_amount', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    paymentMethodId: uuid('payment_method_id'),
    endMode: rentalEndMode('end_mode'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    towingFee: bigint('towing_fee', { mode: 'number' }),
  },
  (table) => [
    index('rentals_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    uniqueIndex('rentals_one_open_per_scooter')
      .using('btree', table.scooterId.asc().nullsLast().op('uuid_ops'))
      .where(
        sql`(state = ANY (ARRAY['RESERVED'::rental_state, 'UNLOCKING'::rental_state, 'ACTIVE'::rental_state, 'PAUSED'::rental_state, 'ENDING'::rental_state]))`,
      ),
    uniqueIndex('rentals_one_open_per_user')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(
        sql`(state = ANY (ARRAY['RESERVED'::rental_state, 'UNLOCKING'::rental_state, 'ACTIVE'::rental_state, 'PAUSED'::rental_state, 'ENDING'::rental_state]))`,
      ),
    uniqueIndex('rentals_parking_photo_unique')
      .using('btree', table.parkingPhotoId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(parking_photo_id IS NOT NULL)`),
    index('rentals_reservation_due_idx')
      .using('btree', table.reservationExpiresAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(state = 'RESERVED'::rental_state)`),
    index('rentals_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    index('rentals_state_created_idx').using(
      'btree',
      table.state.asc().nullsLast().op('enum_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('rentals_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.endZoneId],
      foreignColumns: [zones.id],
      name: 'rentals_end_zone_id_fkey',
    }),
    foreignKey({
      columns: [table.paymentMethodId],
      foreignColumns: [paymentMethods.id],
      name: 'rentals_payment_method_id_fkey',
    }),
    foreignKey({
      columns: [table.parkingPhotoId],
      foreignColumns: [files.id],
      name: 'rentals_photo_fk',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'rentals_scooter_id_fkey',
    }),
    foreignKey({
      columns: [table.tariffId],
      foreignColumns: [tariffs.id],
      name: 'rentals_tariff_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'rentals_user_id_fkey',
    }),
    unique('rentals_number_key').on(table.number),
    check('rentals_amount_not_negative', sql`(total_amount IS NULL) OR (total_amount >= 0)`),
    check(
      'rentals_card_source_method',
      sql`(payment_source <> 'CARD'::payment_source) OR (payment_method_id IS NOT NULL)`,
    ),
    check(
      'rentals_end_mode_state',
      sql`(end_mode IS NULL) OR (state = ANY (ARRAY['ENDING'::rental_state, 'ENDED'::rental_state, 'UNPAID'::rental_state]))`,
    ),
    check(
      'rentals_reservation_has_expiry',
      sql`(state <> 'RESERVED'::rental_state) OR ((reserved_at IS NOT NULL) AND (reservation_expires_at IS NOT NULL))`,
    ),
    check('rentals_towing_fee_check', sql`towing_fee > 0`),
    check('rentals_towing_fee_remote', sql`(towing_fee IS NULL) OR (end_mode = 'REMOTE'::rental_end_mode)`),
  ],
);

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'wallet_ledger_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    userId: uuid('user_id').notNull(),
    type: ledgerEntryType().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    rentalId: uuid('rental_id'),
    paymentId: uuid('payment_id'),
    staffId: uuid('staff_id'),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    reason: ledgerReason(),
    refundId: uuid('refund_id'),
  },
  (table) => [
    uniqueIndex('wallet_ledger_one_charge_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(type = 'RIDE_CHARGE'::ledger_entry_type)`),
    uniqueIndex('wallet_ledger_one_entry_per_refund')
      .using('btree', sql`refund_id`, sql`((amount > 0))`)
      .where(sql`(refund_id IS NOT NULL)`),
    uniqueIndex('wallet_ledger_one_fee_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'), table.type.asc().nullsLast().op('enum_ops'))
      .where(
        sql`((rental_id IS NOT NULL) AND (type <> ALL (ARRAY['TOPUP'::ledger_entry_type, 'REFUND'::ledger_entry_type, 'ADJUSTMENT'::ledger_entry_type, 'PAYOUT'::ledger_entry_type])))`,
      ),
    uniqueIndex('wallet_ledger_one_topup_per_payment')
      .using('btree', table.paymentId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(type = 'TOPUP'::ledger_entry_type)`),
    index('wallet_ledger_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('wallet_ledger_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int8_ops'),
      table.id.desc().nullsFirst().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'wallet_ledger_payment_id_fkey',
    }),
    foreignKey({
      columns: [table.refundId],
      foreignColumns: [refunds.id],
      name: 'wallet_ledger_refund_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'wallet_ledger_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'wallet_ledger_staff_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [wallets.userId],
      name: 'wallet_ledger_user_id_fkey',
    }),
    check('wallet_ledger_amount_check', sql`amount <> 0`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'audit_log_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    staffId: uuid('staff_id'),
    action: text().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    actor: auditActor().default('STAFF').notNull(),
  },
  (table) => [
    index('audit_log_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('audit_log_entity_idx').using(
      'btree',
      table.entityType.asc().nullsLast().op('text_ops'),
      table.entityId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('audit_log_staff_idx').using(
      'btree',
      table.staffId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'audit_log_staff_id_fkey',
    }),
    check('audit_log_actor_staff', sql`(actor = 'STAFF'::audit_actor) = (staff_id IS NOT NULL)`),
  ],
);

export const contentPageVersions = pgTable(
  'content_page_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    pageId: uuid('page_id').notNull(),
    versionNo: integer('version_no').notNull(),
    title: text().notNull(),
    bodyMd: text('body_md').notNull(),
    status: contentStatus().default('DRAFT').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    changeSummary: text('change_summary'),
  },
  (table) => [
    uniqueIndex('content_page_versions_one_published')
      .using('btree', table.pageId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status = 'PUBLISHED'::content_status)`),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'content_page_versions_created_by_fkey',
    }),
    foreignKey({
      columns: [table.pageId],
      foreignColumns: [contentPages.id],
      name: 'content_page_versions_page_id_fkey',
    }),
    unique('content_page_versions_page_id_version_no_key').on(table.pageId, table.versionNo),
    check('content_page_versions_check', sql`(status = 'DRAFT'::content_status) OR (published_at IS NOT NULL)`),
    check('content_page_versions_version_no_check', sql`version_no > 0`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    isSystem: boolean('is_system').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [unique('roles_name_key').on(table.name)],
);

export const permissions = pgTable(
  'permissions',
  {
    code: text().primaryKey().notNull(),
    module: text().notNull(),
    description: text().notNull(),
  },
  (table) => [check('permissions_code_check', sql`code ~ '^[a-z_]+\.[a-z_]+$'::text`)],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    key: text().notNull(),
    fileId: uuid('file_id').notNull(),
    altText: text('alt_text').notNull(),
    caption: text(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'media_assets_file_id_fkey',
    }),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'media_assets_updated_by_fkey',
    }),
    unique('media_assets_key_key').on(table.key),
    unique('media_assets_file_id_key').on(table.fileId),
    check('media_assets_key_check', sql`key ~ '^[a-z0-9_.-]+$'::text`),
  ],
);

export const contentPages = pgTable(
  'content_pages',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    consentType: consentType('consent_type'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    unique('content_pages_slug_key').on(table.slug),
    unique('content_pages_consent_type_key').on(table.consentType),
    check('content_pages_slug_check', sql`slug ~ '^[a-z0-9-]+$'::text`),
  ],
);

export const contentBlocks = pgTable(
  'content_blocks',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    key: text().notNull(),
    client: contentClient().notNull(),
    title: text(),
    bodyMd: text('body_md'),
    mediaId: uuid('media_id'),
    ctaLabel: text('cta_label'),
    ctaUrl: text('cta_url'),
    sortOrder: integer('sort_order').default(0).notNull(),
    status: contentStatus().default('DRAFT').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    index('content_blocks_client_idx').using(
      'btree',
      table.client.asc().nullsLast().op('int4_ops'),
      table.status.asc().nullsLast().op('int4_ops'),
      table.sortOrder.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.mediaId],
      foreignColumns: [mediaAssets.id],
      name: 'content_blocks_media_id_fkey',
    }),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'content_blocks_updated_by_fkey',
    }),
    unique('content_blocks_key_key').on(table.key),
    check('content_blocks_check', sql`(cta_label IS NULL) = (cta_url IS NULL)`),
    check('content_blocks_check1', sql`num_nonnulls(title, body_md, media_id) > 0`),
    check('content_blocks_key_check', sql`key ~ '^[a-z0-9_.-]+$'::text`),
  ],
);

export const faqItems = pgTable(
  'faq_items',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    category: text().notNull(),
    question: text().notNull(),
    answerMd: text('answer_md').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    status: contentStatus().default('DRAFT').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    index('faq_items_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
      table.category.asc().nullsLast().op('int4_ops'),
      table.sortOrder.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'faq_items_updated_by_fkey',
    }),
  ],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    channel: notificationChannel().notNull(),
    title: text(),
    body: text().notNull(),
    description: text(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'notification_templates_updated_by_fkey',
    }),
    unique('notification_templates_code_channel_key').on(table.code, table.channel),
    check(
      'notification_templates_body_length',
      sql`char_length(body) <=
CASE
    WHEN (channel = 'SMS'::notification_channel) THEN 160
    ELSE 240
END`,
    ),
    check('notification_templates_check', sql`(channel = 'PUSH'::notification_channel) OR (title IS NULL)`),
    check('notification_templates_code_check', sql`code ~ '^[a-z_]+$'::text`),
    check('notification_templates_title_length', sql`(title IS NULL) OR (char_length(title) <= 50)`),
  ],
);

export const news = pgTable(
  'news',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    lead: text(),
    bodyMd: text('body_md').notNull(),
    mediaId: uuid('media_id'),
    status: contentStatus().default('DRAFT').notNull(),
    publishFrom: timestamp('publish_from', { withTimezone: true, mode: 'date' }),
    publishTo: timestamp('publish_to', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    index('news_published_idx')
      .using('btree', table.publishFrom.desc().nullsFirst().op('timestamptz_ops'))
      .where(sql`(status = 'PUBLISHED'::content_status)`),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'news_created_by_fkey',
    }),
    foreignKey({
      columns: [table.mediaId],
      foreignColumns: [mediaAssets.id],
      name: 'news_media_id_fkey',
    }),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'news_updated_by_fkey',
    }),
    unique('news_slug_key').on(table.slug),
    check('news_check', sql`(status <> 'PUBLISHED'::content_status) OR (publish_from IS NOT NULL)`),
    check('news_check1', sql`(publish_to IS NULL) OR (publish_from IS NULL) OR (publish_to > publish_from)`),
    check('news_slug_check', sql`slug ~ '^[a-z0-9-]+$'::text`),
  ],
);

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    code: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    permissionCode: text('permission_code').notNull(),
    parameters: jsonb().default({}).notNull(),
    formats: reportFormat().array().default(['PDF', 'XLSX']).notNull(),
    active: boolean().default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.permissionCode],
      foreignColumns: [permissions.code],
      name: 'report_definitions_permission_code_fkey',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'report_definitions_updated_by_fkey',
    }),
    check('report_definitions_code_check', sql`code ~ '^[a-z_]+$'::text`),
    check('report_definitions_formats_check', sql`cardinality(formats) > 0`),
  ],
);

export const reportRuns = pgTable(
  'report_runs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reportCode: text('report_code').notNull(),
    format: reportFormat().notNull(),
    params: jsonb().default({}).notNull(),
    status: jobStatus().default('QUEUED').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    fileId: uuid('file_id'),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('report_runs_report_idx').using(
      'btree',
      table.reportCode.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    index('report_runs_requested_idx').using(
      'btree',
      table.requestedBy.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'report_runs_file_id_fkey',
    }),
    foreignKey({
      columns: [table.reportCode],
      foreignColumns: [reportDefinitions.code],
      name: 'report_runs_report_code_fkey',
    }),
    foreignKey({
      columns: [table.requestedBy],
      foreignColumns: [staff.id],
      name: 'report_runs_requested_by_fkey',
    }),
    check('report_runs_check', sql`(status <> 'SUCCEEDED'::job_status) OR (file_id IS NOT NULL)`),
    check('report_runs_check1', sql`(status <> 'FAILED'::job_status) OR (error IS NOT NULL)`),
  ],
);

export const documentTemplates = pgTable(
  'document_templates',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    documentType: documentType('document_type').notNull(),
    name: text().notNull(),
    description: text(),
    isDefault: boolean('is_default').default(false).notNull(),
    active: boolean().default(true).notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    uniqueIndex('document_templates_one_default')
      .using('btree', table.documentType.asc().nullsLast().op('enum_ops'))
      .where(sql`is_default`),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'document_templates_created_by_fkey',
    }),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'document_templates_updated_by_fkey',
    }),
    unique('document_templates_document_type_name_key').on(table.documentType, table.name),
    check('document_templates_check', sql`active OR (NOT is_default)`),
  ],
);

export const documentTemplateVersions = pgTable(
  'document_template_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    templateId: uuid('template_id').notNull(),
    versionNo: integer('version_no').notNull(),
    fileId: uuid('file_id').notNull(),
    fields: text().array().default(['']).notNull(),
    isActive: boolean('is_active').default(false).notNull(),
    note: text(),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('document_template_versions_one_active')
      .using('btree', table.templateId.asc().nullsLast().op('uuid_ops'))
      .where(sql`is_active`),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'document_template_versions_file_id_fkey',
    }),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [documentTemplates.id],
      name: 'document_template_versions_template_id_fkey',
    }),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [staff.id],
      name: 'document_template_versions_uploaded_by_fkey',
    }),
    unique('document_template_versions_template_id_version_no_key').on(table.templateId, table.versionNo),
    unique('document_template_versions_file_id_key').on(table.fileId),
    check('document_template_versions_version_no_check', sql`version_no > 0`),
  ],
);

export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    documentType: documentType('document_type').notNull(),
    templateVersionId: uuid('template_version_id').notNull(),
    entityRef: text('entity_ref').notNull(),
    params: jsonb().default({}).notNull(),
    status: jobStatus().default('QUEUED').notNull(),
    docxFileId: uuid('docx_file_id'),
    pdfFileId: uuid('pdf_file_id'),
    requestedByStaff: uuid('requested_by_staff'),
    requestedByUser: uuid('requested_by_user'),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('generated_documents_entity_idx').using(
      'btree',
      table.documentType.asc().nullsLast().op('timestamptz_ops'),
      table.entityRef.asc().nullsLast().op('enum_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.docxFileId],
      foreignColumns: [files.id],
      name: 'generated_documents_docx_file_id_fkey',
    }),
    foreignKey({
      columns: [table.pdfFileId],
      foreignColumns: [files.id],
      name: 'generated_documents_pdf_file_id_fkey',
    }),
    foreignKey({
      columns: [table.requestedByStaff],
      foreignColumns: [staff.id],
      name: 'generated_documents_requested_by_staff_fkey',
    }),
    foreignKey({
      columns: [table.requestedByUser],
      foreignColumns: [users.id],
      name: 'generated_documents_requested_by_user_fkey',
    }),
    foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [documentTemplateVersions.id],
      name: 'generated_documents_template_version_id_fkey',
    }),
    check('generated_documents_check', sql`num_nonnulls(requested_by_staff, requested_by_user) = 1`),
    check('generated_documents_check1', sql`(status <> 'SUCCEEDED'::job_status) OR (docx_file_id IS NOT NULL)`),
    check('generated_documents_check2', sql`(status <> 'FAILED'::job_status) OR (error IS NOT NULL)`),
  ],
);

export const scooterModels = pgTable(
  'scooter_models',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    manufacturer: text(),
    maxSpeedKmh: smallint('max_speed_kmh'),
    batteryWh: integer('battery_wh'),
    rangeKm: smallint('range_km'),
    weightKg: numeric('weight_kg', { precision: 4, scale: 1 }),
    description: text(),
    photoMediaId: uuid('photo_media_id'),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.photoMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'scooter_models_photo_media_id_fkey',
    }),
    unique('scooter_models_code_key').on(table.code),
    check('scooter_models_battery_wh_check', sql`battery_wh > 0`),
    check('scooter_models_max_speed_kmh_check', sql`max_speed_kmh > 0`),
    check('scooter_models_range_km_check', sql`range_km > 0`),
    check('scooter_models_weight_kg_check', sql`weight_kg > (0)::numeric`),
  ],
);

export const spareParts = pgTable(
  'spare_parts',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    sku: text().notNull(),
    name: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitCost: bigint('unit_cost', { mode: 'number' }).notNull(),
    stockQty: integer('stock_qty').default(0).notNull(),
    minStockQty: integer('min_stock_qty').default(0).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    unique('spare_parts_sku_key').on(table.sku),
    check('spare_parts_min_stock_qty_check', sql`min_stock_qty >= 0`),
    check('spare_parts_stock_qty_check', sql`stock_qty >= 0`),
    check('spare_parts_unit_cost_check', sql`unit_cost >= 0`),
  ],
);

export const receipts = pgTable(
  'receipts',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    number: text()
      .default(
        sql`(((\'PAR/\'::text || to_char((now() AT TIME ZONE \'Europe/Warsaw\'::text), \'YYYY\'::text)) || \'/\'::text) || lpad((nextval(\'receipt_number_seq\'::regclass))::text, 6, \'0\'::text))`,
      )
      .notNull(),
    userId: uuid('user_id').notNull(),
    paymentId: uuid('payment_id'),
    rentalId: uuid('rental_id'),
    buyerName: text('buyer_name'),
    buyerEmail: text('buyer_email'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    currency: char({ length: 3 }).default('PLN').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    kind: receiptKind().default('SALE').notNull(),
    correctsReceiptId: uuid('corrects_receipt_id'),
    refundId: uuid('refund_id'),
    paymentSource: paymentSource('payment_source'),
    seller: jsonb(),
    buyerPhone: text('buyer_phone'),
  },
  (table) => [
    uniqueIndex('receipts_one_sale_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`((kind = 'SALE'::receipt_kind) AND (rental_id IS NOT NULL))`),
    index('receipts_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('receipts_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.issuedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.correctsReceiptId],
      foreignColumns: [table.id],
      name: 'receipts_corrects_receipt_id_fkey',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'receipts_payment_id_fkey',
    }),
    foreignKey({
      columns: [table.refundId],
      foreignColumns: [refunds.id],
      name: 'receipts_refund_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'receipts_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'receipts_user_id_fkey',
    }),
    unique('receipts_number_key').on(table.number),
    unique('receipts_payment_id_key').on(table.paymentId),
    unique('receipts_refund_id_key').on(table.refundId),
    check('receipts_check', sql`num_nonnulls(payment_id, rental_id) > 0`),
    check(
      'receipts_kind_total',
      sql`((kind = 'SALE'::receipt_kind) AND (total_amount >= 0) AND (corrects_receipt_id IS NULL)) OR ((kind = 'CORRECTION'::receipt_kind) AND (total_amount < 0) AND (corrects_receipt_id IS NOT NULL))`,
    ),
  ],
);

export const serviceTasks = pgTable(
  'service_tasks',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    number: bigint({ mode: 'number' })
      .default(sql`nextval('service_task_number_seq'::regclass)`)
      .notNull(),
    scooterId: uuid('scooter_id').notNull(),
    ticketId: uuid('ticket_id'),
    type: serviceTaskType().notNull(),
    status: serviceTaskStatus().default('OPEN').notNull(),
    priority: taskPriority().default('NORMAL').notNull(),
    description: text(),
    resultNote: text('result_note'),
    assigneeId: uuid('assignee_id'),
    createdBy: uuid('created_by'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    targetZoneId: uuid('target_zone_id'),
    targetPoint: geometry('target_point', { type: 'point', srid: 4326 }),
    cancelReason: text('cancel_reason'),
    cancelledBy: uuid('cancelled_by'),
  },
  (table) => [
    index('service_tasks_assignee_idx')
      .using('btree', table.assigneeId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status = ANY (ARRAY['OPEN'::service_task_status, 'IN_PROGRESS'::service_task_status]))`),
    uniqueIndex('service_tasks_one_open_per_type')
      .using('btree', table.scooterId.asc().nullsLast().op('uuid_ops'), table.type.asc().nullsLast().op('enum_ops'))
      .where(sql`(status = ANY (ARRAY['OPEN'::service_task_status, 'IN_PROGRESS'::service_task_status]))`),
    index('service_tasks_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('service_tasks_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
      table.priority.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('service_tasks_ticket_idx')
      .using('btree', table.ticketId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(ticket_id IS NOT NULL)`),
    foreignKey({
      columns: [table.assigneeId],
      foreignColumns: [staff.id],
      name: 'service_tasks_assignee_id_fkey',
    }),
    foreignKey({
      columns: [table.cancelledBy],
      foreignColumns: [staff.id],
      name: 'service_tasks_cancelled_by_fkey',
    }),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'service_tasks_created_by_fkey',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'service_tasks_scooter_id_fkey',
    }),
    foreignKey({
      columns: [table.targetZoneId],
      foreignColumns: [zones.id],
      name: 'service_tasks_target_zone_id_fkey',
    }),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: 'service_tasks_ticket_id_fkey',
    }),
    unique('service_tasks_number_key').on(table.number),
    check(
      'service_tasks_cancel_reason',
      sql`(status = 'CANCELLED'::service_task_status) = (btrim(COALESCE(cancel_reason, ''::text)) <> ''::text)`,
    ),
    check('service_tasks_cancelled_by', sql`(status = 'CANCELLED'::service_task_status) OR (cancelled_by IS NULL)`),
    check('service_tasks_check', sql`(status <> 'IN_PROGRESS'::service_task_status) OR (assignee_id IS NOT NULL)`),
    check(
      'service_tasks_check1',
      sql`(status = ANY (ARRAY['DONE'::service_task_status, 'CANCELLED'::service_task_status])) = (completed_at IS NOT NULL)`,
    ),
    check(
      'service_tasks_done_has_note',
      sql`(status <> 'DONE'::service_task_status) OR (btrim(COALESCE(result_note, ''::text)) <> ''::text)`,
    ),
    check(
      'service_tasks_relocation_target',
      sql`CHECK (
CASE
    WHEN (type = 'RELOCATION'::service_task_type) THEN (num_nonnulls(target_zone_id, target_point) = 1)
    ELSE ((target_zone_id IS NULL) AND (target_point IS NULL))
END)`,
    ),
  ],
);

export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    staffId: uuid('staff_id').notNull(),
    familyId: uuid('family_id').defaultRandom().notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    replacedBy: uuid('replaced_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('staff_sessions_family_idx').using('btree', table.familyId.asc().nullsLast().op('uuid_ops')),
    index('staff_sessions_staff_active_idx')
      .using('btree', table.staffId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(revoked_at IS NULL)`),
    foreignKey({
      columns: [table.replacedBy],
      foreignColumns: [table.id],
      name: 'staff_sessions_replaced_by_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'staff_sessions_staff_id_fkey',
    }),
    unique('staff_sessions_refresh_token_hash_key').on(table.refreshTokenHash),
    check('staff_sessions_check', sql`(replaced_by IS NULL) OR (revoked_at IS NOT NULL)`),
  ],
);

export const staff = pgTable(
  'staff',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text('password_hash'),
    totpSecretEnc: text('totp_secret_enc'),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true, mode: 'date' }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    failedLogins: smallint('failed_logins').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('staff_email_key').on(table.email),
    check('staff_failed_logins_check', sql`failed_logins >= 0`),
    check('staff_totp_confirmed_has_secret', sql`(totp_confirmed_at IS NULL) OR (totp_secret_enc IS NOT NULL)`),
  ],
);

export const staffInvitations = pgTable(
  'staff_invitations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    staffId: uuid('staff_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('staff_invitations_one_open')
      .using('btree', table.staffId.asc().nullsLast().op('uuid_ops'))
      .where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [staff.id],
      name: 'staff_invitations_invited_by_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'staff_invitations_staff_id_fkey',
    }),
    unique('staff_invitations_token_hash_key').on(table.tokenHash),
    check('staff_invitations_check', sql`num_nonnulls(accepted_at, revoked_at) <= 1`),
    check('staff_invitations_check1', sql`expires_at > created_at`),
  ],
);

export const scooterZoneControl = pgTable(
  'scooter_zone_control',
  {
    scooterId: uuid('scooter_id').primaryKey().notNull(),
    rentalId: uuid('rental_id').notNull(),
    speedLimitKmh: smallint('speed_limit_kmh'),
    limitSynced: boolean('limit_synced').default(true).notNull(),
    limitCommandId: uuid('limit_command_id'),
    stopped: boolean().default(false).notNull(),
    stopSynced: boolean('stop_synced').default(true).notNull(),
    stopCommandId: uuid('stop_command_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('scooter_zone_control_rental_key').using('btree', table.rentalId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.limitCommandId],
      foreignColumns: [scooterCommands.id],
      name: 'scooter_zone_control_limit_command_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'scooter_zone_control_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'scooter_zone_control_scooter_id_fkey',
    }),
    foreignKey({
      columns: [table.stopCommandId],
      foreignColumns: [scooterCommands.id],
      name: 'scooter_zone_control_stop_command_id_fkey',
    }),
    check('scooter_zone_control_speed_limit_kmh_check', sql`speed_limit_kmh > 0`),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    rentalId: uuid('rental_id'),
    paymentId: uuid('payment_id'),
    source: paymentSource().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    reason: refundReason().notNull(),
    note: text(),
    staffId: uuid('staff_id'),
    status: refundStatus().default('PENDING').notNull(),
    providerRefundId: text('provider_refund_id'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    ticketId: uuid('ticket_id'),
  },
  (table) => [
    index('refunds_payment_idx')
      .using('btree', table.paymentId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(payment_id IS NOT NULL)`),
    index('refunds_pending_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'PENDING'::refund_status)`),
    index('refunds_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('refunds_ticket_idx')
      .using('btree', table.ticketId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(ticket_id IS NOT NULL)`),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'refunds_payment_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'refunds_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'refunds_staff_id_fkey',
    }),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: 'refunds_ticket_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'refunds_user_id_fkey',
    }),
    unique('refunds_provider_refund_id_key').on(table.providerRefundId),
    check('refunds_amount_check', sql`amount > 0`),
    check('refunds_check', sql`num_nonnulls(rental_id, payment_id) > 0`),
    check('refunds_check1', sql`(source = 'WALLET'::payment_source) OR (payment_id IS NOT NULL)`),
    check('refunds_check2', sql`(reason <> 'OTHER'::refund_reason) OR (note IS NOT NULL)`),
    check('refunds_check3', sql`(reason = 'BALANCE_PAYOUT'::refund_reason) = (rental_id IS NULL)`),
    check('refunds_ticket_has_rental', sql`(ticket_id IS NULL) OR (rental_id IS NOT NULL)`),
  ],
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'payment_webhook_events_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    providerEventId: text('provider_event_id').notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    provider: text().default('stripe').notNull(),
    objectId: text('object_id'),
    paymentId: uuid('payment_id'),
    deliveries: integer().default(1).notNull(),
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    result: text(),
    error: text(),
  },
  (table) => [
    index('payment_webhook_events_payment_idx')
      .using('btree', table.paymentId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(payment_id IS NOT NULL)`),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'payment_webhook_events_payment_id_fkey',
    }),
    unique('payment_webhook_events_provider_event_id_key').on(table.providerEventId),
    check('payment_webhook_events_deliveries_check', sql`deliveries > 0`),
    check('payment_webhook_events_provider_check', sql`provider = ANY (ARRAY['fake'::text, 'stripe'::text])`),
    check(
      'payment_webhook_events_result_check',
      sql`result = ANY (ARRAY['APPLIED'::text, 'NO_CHANGE'::text, 'IGNORED'::text, 'FAILED'::text])`,
    ),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    scooterId: uuid('scooter_id').notNull(),
    rentalId: uuid('rental_id'),
    reportedBy: uuid('reported_by'),
    source: ticketSource().notNull(),
    categories: ticketCategory().array().notNull(),
    description: text(),
    status: ticketStatus().default('NEW').notNull(),
    urgent: boolean().default(false).notNull(),
    assigneeId: uuid('assignee_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    number: bigint({ mode: 'number' })
      .default(sql`nextval('ticket_number_seq'::regclass)`)
      .notNull(),
    autoKind: ticketAutoKind('auto_kind'),
    customerReply: text('customer_reply'),
    customerReplyAt: timestamp('customer_reply_at', { withTimezone: true, mode: 'date' }),
    customerReplyReadAt: timestamp('customer_reply_read_at', { withTimezone: true, mode: 'date' }),
    resolutionNote: text('resolution_note'),
  },
  (table) => [
    uniqueIndex('tickets_one_open_auto_per_scooter')
      .using('btree', table.scooterId.asc().nullsLast().op('uuid_ops'), table.autoKind.asc().nullsLast().op('enum_ops'))
      .where(sql`(status <> 'RESOLVED'::ticket_status)`),
    index('tickets_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('tickets_reporter_idx')
      .using(
        'btree',
        table.reportedBy.asc().nullsLast().op('uuid_ops'),
        table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
      )
      .where(sql`(reported_by IS NOT NULL)`),
    index('tickets_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('tickets_scooter_open_idx')
      .using('btree', table.scooterId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status <> 'RESOLVED'::ticket_status)`),
    index('tickets_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.assigneeId],
      foreignColumns: [staff.id],
      name: 'tickets_assignee_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'tickets_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.reportedBy],
      foreignColumns: [users.id],
      name: 'tickets_reported_by_fkey',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'tickets_scooter_id_fkey',
    }),
    unique('tickets_number_key').on(table.number),
    check(
      'tickets_auto_kind_category',
      sql`(auto_kind IS NULL) OR ((categories)::text[] @> ARRAY[
CASE auto_kind
    WHEN 'OFFLINE'::ticket_auto_kind THEN 'CONNECTION'::text
    WHEN 'BATTERY_CRITICAL'::ticket_auto_kind THEN 'BATTERY'::text
    ELSE 'OUT_OF_ZONE'::text
END])`,
    ),
    check('tickets_auto_kind_source', sql`(source = 'AUTO'::ticket_source) = (auto_kind IS NOT NULL)`),
    check(
      'tickets_billing_has_rental',
      sql`(NOT ('BILLING'::text = ANY ((categories)::text[]))) OR (rental_id IS NOT NULL)`,
    ),
    check('tickets_categories_check', sql`cardinality(categories) > 0`),
    check(
      'tickets_customer_reply_check',
      sql`(char_length(customer_reply) >= 1) AND (char_length(customer_reply) <= 500)`,
    ),
    check(
      'tickets_reply_consistent',
      sql`((customer_reply IS NULL) = (customer_reply_at IS NULL)) AND ((customer_reply_read_at IS NULL) OR (customer_reply_at IS NOT NULL))`,
    ),
    check('tickets_resolved_at', sql`(status = 'RESOLVED'::ticket_status) = (resolved_at IS NOT NULL)`),
    check(
      'tickets_system_categories',
      sql`(source <> 'USER'::ticket_source) OR (NOT ((categories)::text[] && ARRAY['CONNECTION'::text, 'OUT_OF_ZONE'::text]))`,
    ),
    check(
      'tickets_urgent_from_categories',
      sql`urgent = (categories && ARRAY['BRAKES'::ticket_category, 'WHEEL'::ticket_category, 'HANDLEBAR'::ticket_category])`,
    ),
    check('tickets_user_has_reporter', sql`(source <> 'USER'::ticket_source) OR (reported_by IS NOT NULL)`),
  ],
);

export const sparePartMovements = pgTable(
  'spare_part_movements',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'spare_part_movements_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    partId: uuid('part_id').notNull(),
    kind: partMovementKind().notNull(),
    delta: integer().notNull(),
    stockAfter: integer('stock_after').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitCost: bigint('unit_cost', { mode: 'number' }),
    taskId: uuid('task_id'),
    staffId: uuid('staff_id'),
    document: text(),
    reason: partAdjustReason(),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('spare_part_movements_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('spare_part_movements_part_idx').using(
      'btree',
      table.partId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('spare_part_movements_task_idx')
      .using('btree', table.taskId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(task_id IS NOT NULL)`),
    foreignKey({
      columns: [table.partId],
      foreignColumns: [spareParts.id],
      name: 'spare_part_movements_part_id_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'spare_part_movements_staff_id_fkey',
    }),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [serviceTasks.id],
      name: 'spare_part_movements_task_id_fkey',
    }),
    check('spare_part_movements_delta_check', sql`delta <> 0`),
    check('spare_part_movements_document', sql`(kind = 'RECEIPT'::part_movement_kind) OR (document IS NULL)`),
    check(
      'spare_part_movements_other_note',
      sql`(reason IS DISTINCT FROM 'OTHER'::part_adjust_reason) OR (btrim(COALESCE(note, ''::text)) <> ''::text)`,
    ),
    check('spare_part_movements_reason', sql`(kind = 'ADJUSTMENT'::part_movement_kind) = (reason IS NOT NULL)`),
    check(
      'spare_part_movements_sign',
      sql`((kind = 'USE'::part_movement_kind) AND (delta < 0)) OR ((kind = ANY (ARRAY['RECEIPT'::part_movement_kind, 'RETURN'::part_movement_kind])) AND (delta > 0)) OR (kind = 'ADJUSTMENT'::part_movement_kind)`,
    ),
    check('spare_part_movements_stock_after_check', sql`stock_after >= 0`),
    check(
      'spare_part_movements_task',
      sql`(kind = ANY (ARRAY['USE'::part_movement_kind, 'RETURN'::part_movement_kind])) = (task_id IS NOT NULL)`,
    ),
    check('spare_part_movements_unit_cost_check', sql`unit_cost >= 0`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    storageKey: text('storage_key').notNull(),
    purpose: filePurpose().notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    uploadedByStaff: uuid('uploaded_by_staff'),
    originalName: text('original_name'),
    status: fileStatus().default('READY').notNull(),
    sha256: text(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('files_ready_purpose_idx')
      .using(
        'btree',
        table.purpose.asc().nullsLast().op('enum_ops'),
        table.createdAt.asc().nullsLast().op('timestamptz_ops'),
      )
      .where(sql`(status = 'READY'::file_status)`),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [users.id],
      name: 'files_uploaded_by_fkey',
    }),
    foreignKey({
      columns: [table.uploadedByStaff],
      foreignColumns: [staff.id],
      name: 'files_uploaded_by_staff_fkey',
    }),
    unique('files_storage_key_key').on(table.storageKey),
    check('files_deleted_at', sql`(status = 'DELETED'::file_status) = (deleted_at IS NOT NULL)`),
    check('files_one_uploader', sql`num_nonnulls(uploaded_by, uploaded_by_staff) <= 1`),
    check('files_sha256_check', sql`sha256 ~ '^[0-9a-f]{64}$'::text`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity({
        name: 'notifications_id_seq',
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: 9223372036854775807,
        cache: 1,
      }),
    userId: uuid('user_id').notNull(),
    templateCode: text('template_code').notNull(),
    payload: jsonb().default({}).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    channel: notificationChannel().default('PUSH').notNull(),
    status: notificationStatus().default('QUEUED').notNull(),
    error: text(),
    dedupeKey: text('dedupe_key'),
    providerRef: text('provider_ref'),
    templateVersion: integer('template_version'),
    title: text(),
    body: text(),
    rentalId: uuid('rental_id'),
    ticketId: uuid('ticket_id'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('notifications_queued_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'QUEUED'::notification_status)`),
    index('notifications_rental_idx')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(rental_id IS NOT NULL)`),
    index('notifications_ticket_idx')
      .using('btree', table.ticketId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(ticket_id IS NOT NULL)`),
    index('notifications_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'notifications_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: 'notifications_ticket_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'notifications_user_id_fkey',
    }),
    unique('notifications_dedupe_key_key').on(table.dedupeKey),
    check('notifications_failed_error', sql`(status <> 'FAILED'::notification_status) OR (error IS NOT NULL)`),
    check('notifications_sent_at', sql`(status = 'SENT'::notification_status) = (sent_at IS NOT NULL)`),
    check('notifications_template_code', sql`template_code ~ '^[a-z_]+$'::text`),
    check('notifications_template_version_check', sql`template_version > 0`),
  ],
);

export const notificationTemplateVersions = pgTable(
  'notification_template_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    templateId: uuid('template_id').notNull(),
    version: integer().notNull(),
    title: text(),
    body: text().notNull(),
    staffId: uuid('staff_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'notification_template_versions_staff_id_fkey',
    }),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [notificationTemplates.id],
      name: 'notification_template_versions_template_id_fkey',
    }),
    unique('notification_template_versions_template_id_version_key').on(table.templateId, table.version),
    check('notification_template_versions_version_check', sql`version > 0`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permissionCode: text('permission_code').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.permissionCode],
      foreignColumns: [permissions.code],
      name: 'role_permissions_permission_code_fkey',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'role_permissions_role_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.roleId, table.permissionCode], name: 'role_permissions_pkey' }),
  ],
);

export const ticketPhotos = pgTable(
  'ticket_photos',
  {
    ticketId: uuid('ticket_id').notNull(),
    fileId: uuid('file_id').notNull(),
    position: smallint().notNull(),
  },
  (table) => [
    uniqueIndex('ticket_photos_file_unique').using('btree', table.fileId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'ticket_photos_file_id_fkey',
    }),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: 'ticket_photos_ticket_id_fkey',
    }),
    primaryKey({ columns: [table.ticketId, table.fileId], name: 'ticket_photos_pkey' }),
    unique('ticket_photos_one_per_position').on(table.ticketId, table.position),
    check('ticket_photos_position_range', sql`("position" >= 1) AND ("position" <= 3)`),
  ],
);

export const staffRoles = pgTable(
  'staff_roles',
  {
    staffId: uuid('staff_id').notNull(),
    roleId: uuid('role_id').notNull(),
    assignedBy: uuid('assigned_by'),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('staff_roles_role_idx').using('btree', table.roleId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.assignedBy],
      foreignColumns: [staff.id],
      name: 'staff_roles_assigned_by_fkey',
    }),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'staff_roles_role_id_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'staff_roles_staff_id_fkey',
    }),
    primaryKey({ columns: [table.staffId, table.roleId], name: 'staff_roles_pkey' }),
  ],
);

export const serviceTaskParts = pgTable(
  'service_task_parts',
  {
    taskId: uuid('task_id').notNull(),
    partId: uuid('part_id').notNull(),
    quantity: integer().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitCost: bigint('unit_cost', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('service_task_parts_part_idx').using('btree', table.partId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.partId],
      foreignColumns: [spareParts.id],
      name: 'service_task_parts_part_id_fkey',
    }),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [serviceTasks.id],
      name: 'service_task_parts_task_id_fkey',
    }),
    primaryKey({ columns: [table.taskId, table.partId], name: 'service_task_parts_pkey' }),
    check('service_task_parts_quantity_check', sql`quantity > 0`),
    check('service_task_parts_unit_cost_check', sql`unit_cost >= 0`),
  ],
);

export const paymentCustomers = pgTable(
  'payment_customers',
  {
    userId: uuid('user_id').notNull(),
    provider: text().notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'payment_customers_user_id_fkey',
    }),
    primaryKey({ columns: [table.userId, table.provider], name: 'payment_customers_pkey' }),
    unique('payment_customers_provider_provider_customer_id_key').on(table.provider, table.providerCustomerId),
    check('payment_customers_provider_check', sql`provider = ANY (ARRAY['fake'::text, 'stripe'::text])`),
  ],
);

export const scooterZonePresence = pgTable(
  'scooter_zone_presence',
  {
    scooterId: uuid('scooter_id').notNull(),
    zoneId: uuid('zone_id').notNull(),
    rentalId: uuid('rental_id').notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true, mode: 'date' }).notNull(),
    outsideCount: smallint('outside_count').default(0).notNull(),
  },
  (table) => [
    index('scooter_zone_presence_rental_idx').using('btree', table.rentalId.asc().nullsLast().op('uuid_ops')),
    index('scooter_zone_presence_zone_idx').using('btree', table.zoneId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'scooter_zone_presence_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'scooter_zone_presence_scooter_id_fkey',
    }),
    foreignKey({
      columns: [table.zoneId],
      foreignColumns: [zones.id],
      name: 'scooter_zone_presence_zone_id_fkey',
    }),
    primaryKey({ columns: [table.scooterId, table.zoneId], name: 'scooter_zone_presence_pkey' }),
    check('scooter_zone_presence_outside_count_check', sql`outside_count >= 0`),
  ],
);

export const receiptItems = pgTable(
  'receipt_items',
  {
    receiptId: uuid('receipt_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    description: text().notNull(),
    quantity: numeric({ precision: 10, scale: 3 }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    vatRate: numeric('vat_rate', { precision: 4, scale: 2 }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.receiptId],
      foreignColumns: [receipts.id],
      name: 'receipt_items_receipt_id_fkey',
    }),
    primaryKey({ columns: [table.receiptId, table.lineNo], name: 'receipt_items_pkey' }),
    check('receipt_items_line_no_check', sql`line_no > 0`),
    check('receipt_items_quantity_check', sql`quantity > (0)::numeric`),
    check('receipt_items_vat_rate_check', sql`vat_rate >= (0)::numeric`),
  ],
);
export const vFleetStatus = pgView('v_fleet_status', {
  id: uuid(),
  number: integer(),
  serialNumber: text('serial_number'),
  variant: scooterVariant(),
  status: scooterStatus(),
  online: boolean(),
  batteryPct: smallint('battery_pct'),
  position: geometry({ type: 'point', srid: 4326 }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  firmware: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  odometerM: bigint('odometer_m', { mode: 'number' }),
  modelId: uuid('model_id'),
  modelCode: text('model_code'),
  modelName: text('model_name'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  rentalState: rentalState('rental_state'),
  rentalUserId: uuid('rental_user_id'),
  parkingZoneCode: text('parking_zone_code'),
  parkingZoneName: text('parking_zone_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  openTickets: bigint('open_tickets', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  openServiceTasks: bigint('open_service_tasks', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentals30D: bigint('rentals_30d', { mode: 'number' }),
}).as(
  sql`SELECT s.id, s.number, s.serial_number, s.variant, s.status, s.online, s.battery_pct, s."position", s.last_seen_at, s.firmware, s.odometer_m, s.model_id, m.code AS model_code, m.name AS model_name, r.id AS rental_id, r.number AS rental_number, r.state AS rental_state, r.user_id AS rental_user_id, pz.code AS parking_zone_code, pz.name AS parking_zone_name, ( SELECT count(*) AS count FROM tickets t WHERE t.scooter_id = s.id AND t.status <> 'RESOLVED'::ticket_status) AS open_tickets, ( SELECT count(*) AS count FROM service_tasks st WHERE st.scooter_id = s.id AND (st.status = ANY (ARRAY['OPEN'::service_task_status, 'IN_PROGRESS'::service_task_status]))) AS open_service_tasks, ( SELECT count(*) AS count FROM rentals r30 WHERE r30.scooter_id = s.id AND (r30.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state])) AND r30.ended_at >= (now() - '30 days'::interval)) AS rentals_30d FROM scooters s JOIN scooter_models m ON m.id = s.model_id LEFT JOIN rentals r ON r.scooter_id = s.id AND (r.state = ANY (ARRAY['RESERVED'::rental_state, 'UNLOCKING'::rental_state, 'ACTIVE'::rental_state, 'PAUSED'::rental_state, 'ENDING'::rental_state])) LEFT JOIN LATERAL ( SELECT z.code, z.name FROM zones z WHERE z.active AND z.type = 'PARKING'::zone_type AND st_contains(z.geom, s."position") ORDER BY z.code LIMIT 1) pz ON true`,
);

export const vWalletBalances = pgView('v_wallet_balances', {
  userId: uuid('user_id'),
  phone: text(),
  name: text(),
  userStatus: userStatus('user_status'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  cachedBalance: bigint('cached_balance', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ledgerBalance: bigint('ledger_balance', { mode: 'number' }),
  outOfSync: boolean('out_of_sync'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  entries: bigint({ mode: 'number' }),
  lastEntryAt: timestamp('last_entry_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT w.user_id, u.phone, u.name, u.status AS user_status, w.balance AS cached_balance, COALESCE(l.ledger_balance, 0::bigint) AS ledger_balance, w.balance <> COALESCE(l.ledger_balance, 0::bigint) AS out_of_sync, COALESCE(l.entries, 0::bigint) AS entries, l.last_entry_at, w.updated_at FROM wallets w JOIN users u ON u.id = w.user_id LEFT JOIN ( SELECT wallet_ledger.user_id, sum(wallet_ledger.amount)::bigint AS ledger_balance, count(*) AS entries, max(wallet_ledger.created_at) AS last_entry_at FROM wallet_ledger GROUP BY wallet_ledger.user_id) l ON l.user_id = w.user_id`,
);

export const vTicketQueue = pgView('v_ticket_queue', {
  id: uuid(),
  status: ticketStatus(),
  urgent: boolean(),
  categories: ticketCategory(),
  source: ticketSource(),
  description: text(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  age: interval(),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  scooterStatus: scooterStatus('scooter_status'),
  rentalId: uuid('rental_id'),
  reportedBy: uuid('reported_by'),
  assigneeId: uuid('assignee_id'),
  assigneeName: text('assignee_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  photos: bigint({ mode: 'number' }),
  serviceTaskId: uuid('service_task_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  serviceTaskNumber: bigint('service_task_number', { mode: 'number' }),
  serviceTaskStatus: serviceTaskStatus('service_task_status'),
}).as(
  sql`SELECT t.id, t.status, t.urgent, t.categories, t.source, t.description, t.created_at, now() - t.created_at AS age, t.scooter_id, s.number AS scooter_number, s.status AS scooter_status, t.rental_id, t.reported_by, t.assignee_id, a.name AS assignee_name, ( SELECT count(*) AS count FROM ticket_photos tp WHERE tp.ticket_id = t.id) AS photos, st.id AS service_task_id, st.number AS service_task_number, st.status AS service_task_status FROM tickets t JOIN scooters s ON s.id = t.scooter_id LEFT JOIN staff a ON a.id = t.assignee_id LEFT JOIN LATERAL ( SELECT x.id, x.number, x.status FROM service_tasks x WHERE x.ticket_id = t.id ORDER BY x.created_at DESC LIMIT 1) st ON true WHERE t.status <> 'RESOLVED'::ticket_status`,
);

export const vStaffPermissions = pgView('v_staff_permissions', {
  staffId: uuid('staff_id'),
  permissionCode: text('permission_code'),
}).as(
  sql`SELECT DISTINCT sr.staff_id, rp.permission_code FROM staff_roles sr JOIN staff s ON s.id = sr.staff_id AND s.active JOIN role_permissions rp ON rp.role_id = sr.role_id`,
);

export const vScooterReliability = pgView('v_scooter_reliability', {
  scooterId: uuid('scooter_id'),
  number: integer(),
  modelId: uuid('model_id'),
  modelName: text('model_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  odometerM: bigint('odometer_m', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketsTotal: bigint('tickets_total', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketsOpen: bigint('tickets_open', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  tasksDone: bigint('tasks_done', { mode: 'number' }),
  lastServiceAt: timestamp('last_service_at', { withTimezone: true, mode: 'date' }),
  avgRepairTime: interval('avg_repair_time'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  partsCost: bigint('parts_cost', { mode: 'number' }),
}).as(
  sql`SELECT s.id AS scooter_id, s.number, s.model_id, m.name AS model_name, s.odometer_m, ( SELECT count(*) AS count FROM tickets t WHERE t.scooter_id = s.id) AS tickets_total, ( SELECT count(*) AS count FROM tickets t WHERE t.scooter_id = s.id AND t.status <> 'RESOLVED'::ticket_status) AS tickets_open, ( SELECT count(*) AS count FROM service_tasks st WHERE st.scooter_id = s.id AND st.status = 'DONE'::service_task_status) AS tasks_done, ( SELECT max(st.completed_at) AS max FROM service_tasks st WHERE st.scooter_id = s.id AND st.status = 'DONE'::service_task_status) AS last_service_at, ( SELECT avg(st.completed_at - st.created_at) AS avg FROM service_tasks st WHERE st.scooter_id = s.id AND st.status = 'DONE'::service_task_status AND st.type = 'REPAIR'::service_task_type) AS avg_repair_time, ( SELECT COALESCE(sum(p.quantity * p.unit_cost), 0::numeric)::bigint AS "coalesce" FROM service_task_parts p JOIN service_tasks st ON st.id = p.task_id WHERE st.scooter_id = s.id) AS parts_cost FROM scooters s JOIN scooter_models m ON m.id = s.model_id`,
);

export const vUserActivity = pgView('v_user_activity', {
  id: uuid(),
  phone: text(),
  email: text(),
  name: text(),
  status: userStatus(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rides: bigint({ mode: 'number' }),
  lastRideAt: timestamp('last_ride_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalSpent: bigint('total_spent', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  walletBalance: bigint('wallet_balance', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketsReported: bigint('tickets_reported', { mode: 'number' }),
  blockedAt: timestamp('blocked_at', { withTimezone: true, mode: 'date' }),
  blockedReason: blockReason('blocked_reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  activeSessions: bigint('active_sessions', { mode: 'number' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unpaidRentals: bigint('unpaid_rentals', { mode: 'number' }),
}).as(
  sql`SELECT u.id, u.phone, u.email, u.name, u.status, u.created_at, COALESCE(r.rides, 0::bigint) AS rides, r.last_ride_at, COALESCE(r.spent, 0::bigint) AS total_spent, COALESCE(w.balance, 0::bigint) AS wallet_balance, ( SELECT count(*) AS count FROM tickets t WHERE t.reported_by = u.id) AS tickets_reported, u.blocked_at, u.blocked_reason, u.updated_at, u.version, ( SELECT count(*) AS count FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions, ( SELECT max(s.last_used_at) AS max FROM sessions s WHERE s.user_id = u.id) AS last_seen_at, COALESCE(r.unpaid, 0::bigint) AS unpaid_rentals FROM users u LEFT JOIN ( SELECT rentals.user_id, count(*) AS rides, max(rentals.ended_at) AS last_ride_at, sum(rentals.total_amount)::bigint AS spent, count(*) FILTER (WHERE rentals.state = 'UNPAID'::rental_state) AS unpaid FROM rentals WHERE rentals.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state]) GROUP BY rentals.user_id) r ON r.user_id = u.id LEFT JOIN wallets w ON w.user_id = u.id`,
);

export const vCurrentDocuments = pgView('v_current_documents', {
  pageId: uuid('page_id'),
  slug: text(),
  consentType: consentType('consent_type'),
  versionId: uuid('version_id'),
  versionNo: integer('version_no'),
  title: text(),
  bodyMd: text('body_md'),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT p.id AS page_id, p.slug, p.consent_type, v.id AS version_id, v.version_no, v.title, v.body_md, v.published_at FROM content_pages p JOIN content_page_versions v ON v.page_id = p.id AND v.status = 'PUBLISHED'::content_status`,
);

export const vPublishedNews = pgView('v_published_news', {
  id: uuid(),
  slug: text(),
  title: text(),
  lead: text(),
  bodyMd: text('body_md'),
  mediaId: uuid('media_id'),
  publishFrom: timestamp('publish_from', { withTimezone: true, mode: 'date' }),
  publishTo: timestamp('publish_to', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT id, slug, title, lead, body_md, media_id, publish_from, publish_to FROM news n WHERE status = 'PUBLISHED'::content_status AND publish_from <= now() AND (publish_to IS NULL OR publish_to > now())`,
);

export const vLowStockParts = pgView('v_low_stock_parts', {
  id: uuid(),
  sku: text(),
  name: text(),
  stockQty: integer('stock_qty'),
  minStockQty: integer('min_stock_qty'),
  shortage: integer(),
}).as(
  sql`SELECT id, sku, name, stock_qty, min_stock_qty, min_stock_qty - stock_qty AS shortage FROM spare_parts WHERE active AND stock_qty <= min_stock_qty`,
);

export const vZoneUsage = pgView('v_zone_usage', {
  zoneId: uuid('zone_id'),
  code: text(),
  name: text(),
  type: zoneType(),
  day: date(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ridesEnded: bigint('rides_ended', { mode: 'number' }),
  avgRideSeconds: integer('avg_ride_seconds'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  revenue: bigint({ mode: 'number' }),
}).as(
  sql`SELECT z.id AS zone_id, z.code, z.name, z.type, (r.ended_at AT TIME ZONE 'Europe/Warsaw'::text)::date AS day, count(*) AS rides_ended, avg(r.ride_seconds)::integer AS avg_ride_seconds, COALESCE(sum(r.total_amount), 0::numeric)::bigint AS revenue FROM rentals r JOIN zones z ON z.id = r.end_zone_id WHERE (r.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state])) AND r.ended_at IS NOT NULL GROUP BY z.id, ((r.ended_at AT TIME ZONE 'Europe/Warsaw'::text)::date)`,
);

export const vStaffOverview = pgView('v_staff_overview', {
  id: uuid(),
  email: text(),
  name: text(),
  active: boolean(),
  totpEnabled: boolean('totp_enabled'),
  roles: text(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  status: text(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  roleIds: uuid('role_ids'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  activeSessions: bigint('active_sessions', { mode: 'number' }),
  invitationExpiresAt: timestamp('invitation_expires_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT s.id, s.email, s.name, s.active, s.totp_confirmed_at IS NOT NULL AS totp_enabled, COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'::text[]) AS roles, s.created_at, s.updated_at, CASE WHEN NOT s.active THEN 'DEACTIVATED'::text WHEN s.password_hash IS NULL THEN 'INVITED'::text ELSE 'ACTIVE'::text END AS status, s.last_login_at, s.locked_until, COALESCE(array_agg(r.id ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'::uuid[]) AS role_ids, ( SELECT count(*) AS count FROM staff_sessions ss WHERE ss.staff_id = s.id AND ss.revoked_at IS NULL AND ss.expires_at > now()) AS active_sessions, ( SELECT max(i.expires_at) AS max FROM staff_invitations i WHERE i.staff_id = s.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL) AS invitation_expires_at, s.version FROM staff s LEFT JOIN staff_roles sr ON sr.staff_id = s.id LEFT JOIN roles r ON r.id = sr.role_id GROUP BY s.id`,
);

export const vRolesOverview = pgView('v_roles_overview', {
  id: uuid(),
  name: text(),
  description: text(),
  isSystem: boolean('is_system'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  permissionsCount: bigint('permissions_count', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  staffCount: bigint('staff_count', { mode: 'number' }),
}).as(
  sql`SELECT id, name, description, is_system, created_at, updated_at, version, ( SELECT count(*) AS count FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions_count, ( SELECT count(*) AS count FROM staff_roles sr JOIN staff s ON s.id = sr.staff_id AND s.active WHERE sr.role_id = r.id) AS staff_count FROM roles r`,
);

export const vUserConsents = pgView('v_user_consents', {
  userId: uuid('user_id'),
  type: consentType(),
  consentId: uuid('consent_id'),
  documentVersion: text('document_version'),
  pageVersionId: uuid('page_version_id'),
  versionNo: integer('version_no'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  currentVersionId: uuid('current_version_id'),
  currentVersionNo: integer('current_version_no'),
  isCurrent: boolean('is_current'),
}).as(
  sql`SELECT DISTINCT ON (c.user_id, c.type) c.user_id, c.type, c.id AS consent_id, c.document_version, c.page_version_id, v.version_no, c.accepted_at, c.revoked_at, cur.version_id AS current_version_id, cur.version_no AS current_version_no, c.revoked_at IS NULL AND (cur.version_id IS NULL OR c.page_version_id = cur.version_id) AS is_current FROM consents c LEFT JOIN content_page_versions v ON v.id = c.page_version_id LEFT JOIN v_current_documents cur ON cur.consent_type = c.type ORDER BY c.user_id, c.type, c.accepted_at DESC`,
);

export const vAuditLog = pgView('v_audit_log', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  staffEmail: text('staff_email'),
  action: text(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  data: jsonb(),
  actor: auditActor(),
}).as(
  sql`SELECT a.id, a.created_at, a.staff_id, s.name AS staff_name, s.email AS staff_email, a.action, a.entity_type, a.entity_id, a.data, a.actor FROM audit_log a LEFT JOIN staff s ON s.id = a.staff_id`,
);

export const vScooterModels = pgView('v_scooter_models', {
  id: uuid(),
  code: text(),
  name: text(),
  manufacturer: text(),
  maxSpeedKmh: smallint('max_speed_kmh'),
  batteryWh: integer('battery_wh'),
  rangeKm: smallint('range_km'),
  weightKg: numeric('weight_kg', { precision: 4, scale: 1 }),
  description: text(),
  photoMediaId: uuid('photo_media_id'),
  active: boolean(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  scootersTotal: bigint('scooters_total', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  scootersActive: bigint('scooters_active', { mode: 'number' }),
}).as(
  sql`SELECT id, code, name, manufacturer, max_speed_kmh, battery_wh, range_km, weight_kg, description, photo_media_id, active, created_at, updated_at, version, ( SELECT count(*) AS count FROM scooters s WHERE s.model_id = m.id) AS scooters_total, ( SELECT count(*) AS count FROM scooters s WHERE s.model_id = m.id AND s.status <> 'RETIRED'::scooter_status) AS scooters_active FROM scooter_models m`,
);

export const vUserRentalHistory = pgView('v_user_rental_history', {
  id: uuid(),
  userId: uuid('user_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  scooterNumber: integer('scooter_number'),
  scooterVariant: scooterVariant('scooter_variant'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  rideSeconds: integer('ride_seconds'),
  pauseSeconds: integer('pause_seconds'),
  distanceM: integer('distance_m'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalAmount: bigint('total_amount', { mode: 'number' }),
  endZoneCode: text('end_zone_code'),
  endZoneName: text('end_zone_name'),
  tariffVersion: integer('tariff_version'),
}).as(
  sql`SELECT r.id, r.user_id, r.number, s.number AS scooter_number, s.variant AS scooter_variant, r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount, ez.code AS end_zone_code, ez.name AS end_zone_name, t.version AS tariff_version FROM rentals r JOIN scooters s ON s.id = r.scooter_id JOIN tariffs t ON t.id = r.tariff_id LEFT JOIN zones ez ON ez.id = r.end_zone_id WHERE r.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state])`,
);

export const vUserRideStats = pgView('v_user_ride_stats', {
  userId: uuid('user_id'),
  ridesCount: integer('rides_count'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  distanceM: bigint('distance_m', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  travelSeconds: bigint('travel_seconds', { mode: 'number' }),
}).as(
  sql`SELECT u.id AS user_id, count(r.id)::integer AS rides_count, COALESCE(sum(r.distance_m), 0::bigint) AS distance_m, COALESCE(sum(r.ride_seconds + r.pause_seconds), 0::bigint) AS travel_seconds FROM users u LEFT JOIN rentals r ON r.user_id = u.id AND (r.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state])) GROUP BY u.id`,
);

export const vFleetList = pgView('v_fleet_list', {
  id: uuid(),
  number: integer(),
  serialNumber: text('serial_number'),
  variant: scooterVariant(),
  status: scooterStatus(),
  online: boolean(),
  batteryPct: smallint('battery_pct'),
  position: geometry({ type: 'point', srid: 4326 }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  firmware: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  odometerM: bigint('odometer_m', { mode: 'number' }),
  modelId: uuid('model_id'),
  modelCode: text('model_code'),
  modelName: text('model_name'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  rentalState: rentalState('rental_state'),
  rentalUserId: uuid('rental_user_id'),
  parkingZoneCode: text('parking_zone_code'),
  parkingZoneName: text('parking_zone_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  openTickets: bigint('open_tickets', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  openServiceTasks: bigint('open_service_tasks', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentals30D: bigint('rentals_30d', { mode: 'number' }),
  fleetStatus: text('fleet_status'),
  lat: doublePrecision(),
  lon: doublePrecision(),
  modelRangeKm: smallint('model_range_km'),
  version: integer(),
  statusReason: scooterStatusReason('status_reason'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT f.id, f.number, f.serial_number, f.variant, f.status, f.online, f.battery_pct, f."position", f.last_seen_at, f.firmware, f.odometer_m, f.model_id, f.model_code, f.model_name, f.rental_id, f.rental_number, f.rental_state, f.rental_user_id, f.parking_zone_code, f.parking_zone_name, f.open_tickets, f.open_service_tasks, f.rentals_30d, fn_fleet_status(f.status, f.online, f.battery_pct, t.threshold) AS fleet_status, st_y(f."position") AS lat, st_x(f."position") AS lon, m.range_km AS model_range_km, s.version, s.status_reason, s.status_changed_at FROM v_fleet_status f JOIN scooters s ON s.id = f.id JOIN scooter_models m ON m.id = f.model_id CROSS JOIN ( SELECT fn_low_battery_threshold() AS threshold) t`,
);

export const vRentalTimeline = pgView('v_rental_timeline', {
  rentalId: uuid('rental_id'),
  at: timestamp({ withTimezone: true, mode: 'date' }),
  kind: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  eventId: bigint('event_id', { mode: 'number' }),
  type: text(),
  fromState: rentalState('from_state'),
  toState: rentalState('to_state'),
  data: jsonb(),
  zoneCode: text('zone_code'),
  commandId: uuid('command_id'),
  commandStatus: commandStatus('command_status'),
  ackedAt: timestamp('acked_at', { withTimezone: true, mode: 'date' }),
  ackReason: text('ack_reason'),
}).as(
  sql`SELECT e.rental_id, e.created_at AS at, 'EVENT'::text AS kind, e.id AS event_id, e.type::text AS type, e.from_state, e.to_state, e.data, z.code AS zone_code, NULL::uuid AS command_id, NULL::command_status AS command_status, NULL::timestamp with time zone AS acked_at, NULL::text AS ack_reason FROM rental_events e LEFT JOIN zones z ON z.id = e.zone_id UNION ALL SELECT c.rental_id, c.sent_at AS at, 'COMMAND'::text AS kind, NULL::bigint AS event_id, c.type::text AS type, NULL::rental_state AS from_state, NULL::rental_state AS to_state, c.payload AS data, NULL::text AS zone_code, c.id AS command_id, c.status AS command_status, c.acked_at, c.ack_reason FROM scooter_commands c WHERE c.rental_id IS NOT NULL`,
);

export const vZoneList = pgView('v_zone_list', {
  id: uuid(),
  code: text(),
  name: text(),
  type: zoneType(),
  active: boolean(),
  visibleInApp: boolean('visible_in_app'),
  speedLimitKmh: smallint('speed_limit_kmh'),
  capacity: smallint(),
  version: integer(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  areaM2: bigint('area_m2', { mode: 'number' }),
  points: integer(),
  scootersInside: integer('scooters_inside'),
  ridesInside: integer('rides_inside'),
  used: boolean(),
}).as(
  sql`SELECT z.id, z.code, z.name, z.type, z.active, z.visible_in_app, z.speed_limit_kmh, z.capacity, z.version, z.updated_at, z.updated_by, st.name AS updated_by_name, round(st_area(z.geom::geography))::bigint AS area_m2, st_npoints(z.geom) - st_nrings(z.geom) AS points, (( SELECT count(*) AS count FROM scooters s WHERE s.status <> 'RETIRED'::scooter_status AND s."position" IS NOT NULL AND st_contains(z.geom, s."position")))::integer AS scooters_inside, (( SELECT count(*) AS count FROM scooter_zone_presence pr WHERE pr.zone_id = z.id))::integer AS rides_inside, (EXISTS ( SELECT 1 FROM rentals r WHERE r.end_zone_id = z.id)) OR (EXISTS ( SELECT 1 FROM rental_events e WHERE e.zone_id = z.id)) AS used FROM zones z LEFT JOIN staff st ON st.id = z.updated_by`,
);

export const vParkingOccupancy = pgView('v_parking_occupancy', {
  zoneId: uuid('zone_id'),
  code: text(),
  name: text(),
  capacity: smallint(),
  scootersCount: integer('scooters_count'),
  availableCount: integer('available_count'),
  isFull: boolean('is_full'),
}).as(
  sql`SELECT z.id AS zone_id, z.code, z.name, z.capacity, count(s.id)::integer AS scooters_count, count(s.id) FILTER (WHERE s.status = 'AVAILABLE'::scooter_status)::integer AS available_count, z.capacity IS NOT NULL AND count(s.id) >= z.capacity AS is_full FROM zones z LEFT JOIN scooters s ON s.status <> 'RETIRED'::scooter_status AND s."position" IS NOT NULL AND st_contains(z.geom, s."position") WHERE z.active AND z.type = 'PARKING'::zone_type GROUP BY z.id`,
);

export const vPaymentList = pgView('v_payment_list', {
  id: uuid(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  status: paymentStatus(),
  purpose: paymentPurpose(),
  method: paymentMethodKind(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  amount: bigint({ mode: 'number' }),
  currency: char({ length: 3 }),
  provider: text(),
  providerPaymentId: text('provider_payment_id'),
  idempotencyKey: text('idempotency_key'),
  failureReason: text('failure_reason'),
  failureCode: text('failure_code'),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  paymentMethodId: uuid('payment_method_id'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundedAmount: bigint('refunded_amount', { mode: 'number' }),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
  webhookEvents: integer('webhook_events'),
}).as(
  sql`SELECT p.id, p.created_at, p.updated_at, p.status, p.purpose, p.method, p.amount, p.currency, p.provider, p.provider_payment_id, p.idempotency_key, p.failure_reason, p.failure_code, p.user_id, u.name AS user_name, u.phone AS user_phone, p.rental_id, r.number AS rental_number, p.payment_method_id, pm.brand AS card_brand, pm.last4 AS card_last4, ( SELECT COALESCE(sum(f.amount), 0::numeric)::bigint AS "coalesce" FROM refunds f WHERE f.payment_id = p.id AND f.status = 'SUCCEEDED'::refund_status) AS refunded_amount, rc.id AS receipt_id, rc.number AS receipt_number, ( SELECT count(*)::integer AS count FROM payment_webhook_events e WHERE e.payment_id = p.id) AS webhook_events FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN rentals r ON r.id = p.rental_id LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id LEFT JOIN receipts rc ON rc.payment_id = p.id AND rc.kind = 'SALE'::receipt_kind`,
);

export const vTariffVersions = pgView('v_tariff_versions', {
  id: uuid(),
  version: integer(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unlockFee: bigint('unlock_fee', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  minuteRate: bigint('minute_rate', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  pauseMinuteRate: bigint('pause_minute_rate', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  outOfZoneFee: bigint('out_of_zone_fee', { mode: 'number' }),
  freeReservationMinutes: smallint('free_reservation_minutes'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  minWalletBalance: bigint('min_wallet_balance', { mode: 'number' }),
  minBatteryPct: smallint('min_battery_pct'),
  minUserAge: smallint('min_user_age'),
  vatRate: numeric('vat_rate', { precision: 4, scale: 2 }),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
  validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  state: text(),
  createdBy: uuid('created_by'),
  createdByName: text('created_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  rentalsCount: integer('rentals_count'),
}).as(
  sql`SELECT t.id, t.version, t.unlock_fee, t.minute_rate, t.pause_minute_rate, t.out_of_zone_fee, t.free_reservation_minutes, t.min_wallet_balance, t.min_battery_pct, t.min_user_age, t.vat_rate, t.valid_from, ( SELECT min(n.valid_from) AS min FROM tariffs n WHERE n.version > t.version) AS valid_to, CASE WHEN t.valid_from > now() THEN 'SCHEDULED'::text WHEN t.version = (( SELECT max(c.version) AS max FROM tariffs c WHERE c.valid_from <= now())) THEN 'CURRENT'::text ELSE 'ARCHIVED'::text END AS state, t.created_by, s.name AS created_by_name, t.created_at, ( SELECT count(*)::integer AS count FROM rentals r WHERE r.tariff_id = t.id) AS rentals_count FROM tariffs t LEFT JOIN staff s ON s.id = t.created_by`,
);

export const vPaymentMethods = pgView('v_payment_methods', {
  id: uuid(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  provider: text(),
  brand: text(),
  last4: char({ length: 4 }),
  expMonth: smallint('exp_month'),
  expYear: smallint('exp_year'),
  isDefault: boolean('is_default'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
  state: text(),
}).as(
  sql`SELECT pm.id, pm.user_id, u.name AS user_name, u.phone AS user_phone, pm.provider, pm.brand, pm.last4, pm.exp_month, pm.exp_year, pm.is_default, pm.created_at, pm.removed_at, CASE WHEN pm.removed_at IS NOT NULL THEN 'REMOVED'::text WHEN (make_date(pm.exp_year::integer, pm.exp_month::integer, 1) + '1 mon'::interval) <= (now() AT TIME ZONE 'Europe/Warsaw'::text)::date THEN 'EXPIRED'::text WHEN make_date(pm.exp_year::integer, pm.exp_month::integer, 1) <= ((now() AT TIME ZONE 'Europe/Warsaw'::text)::date + '1 mon'::interval) THEN 'EXPIRING'::text ELSE 'ACTIVE'::text END AS state FROM payment_methods pm JOIN users u ON u.id = pm.user_id`,
);

export const vPaymentWebhookEvents = pgView('v_payment_webhook_events', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  provider: text(),
  providerEventId: text('provider_event_id'),
  type: text(),
  objectId: text('object_id'),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
  lastReceivedAt: timestamp('last_received_at', { withTimezone: true, mode: 'date' }),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  deliveries: integer(),
  result: text(),
  error: text(),
  paymentId: uuid('payment_id'),
  paymentPurpose: paymentPurpose('payment_purpose'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  paymentAmount: bigint('payment_amount', { mode: 'number' }),
  userId: uuid('user_id'),
  userName: text('user_name'),
}).as(
  sql`SELECT e.id, e.provider, e.provider_event_id, e.type, e.object_id, e.received_at, e.last_received_at, e.processed_at, e.deliveries, e.result, e.error, e.payment_id, p.purpose AS payment_purpose, p.amount AS payment_amount, p.user_id, u.name AS user_name FROM payment_webhook_events e LEFT JOIN payments p ON p.id = e.payment_id LEFT JOIN users u ON u.id = p.user_id`,
);

export const vRefundList = pgView('v_refund_list', {
  id: uuid(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  status: refundStatus(),
  source: paymentSource(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  amount: bigint({ mode: 'number' }),
  reason: refundReason(),
  note: text(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  paymentId: uuid('payment_id'),
  paymentPurpose: paymentPurpose('payment_purpose'),
  providerRefundId: text('provider_refund_id'),
  failureReason: text('failure_reason'),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
}).as(
  sql`SELECT f.id, f.created_at, f.updated_at, f.status, f.source, f.amount, f.reason, f.note, f.user_id, u.name AS user_name, u.phone AS user_phone, f.rental_id, r.number AS rental_number, f.payment_id, p.purpose AS payment_purpose, f.provider_refund_id, f.failure_reason, f.staff_id, s.name AS staff_name, rc.id AS receipt_id, rc.number AS receipt_number FROM refunds f JOIN users u ON u.id = f.user_id LEFT JOIN rentals r ON r.id = f.rental_id LEFT JOIN payments p ON p.id = f.payment_id LEFT JOIN staff s ON s.id = f.staff_id LEFT JOIN receipts rc ON rc.refund_id = f.id`,
);

export const vUnpaidRentals = pgView('v_unpaid_rentals', {
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  userId: uuid('user_id'),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalAmount: bigint('total_amount', { mode: 'number' }),
  paymentMethodId: uuid('payment_method_id'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  failureReason: text('failure_reason'),
  failureCode: text('failure_code'),
  failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
  failedAttempts: integer('failed_attempts'),
  paymentPending: boolean('payment_pending'),
}).as(
  sql`SELECT r.id AS rental_id, r.number, r.user_id, r.ended_at, r.total_amount, r.payment_method_id, pm.brand AS card_brand, pm.last4 AS card_last4, p.failure_reason, p.failure_code, p.updated_at AS failed_at, ( SELECT count(*)::integer AS count FROM payments a WHERE a.rental_id = r.id AND a.purpose = 'RIDE'::payment_purpose AND a.status = 'FAILED'::payment_status) AS failed_attempts, (EXISTS ( SELECT 1 FROM payments a WHERE a.rental_id = r.id AND a.purpose = 'RIDE'::payment_purpose AND a.status = 'PENDING'::payment_status)) AS payment_pending FROM rentals r LEFT JOIN payment_methods pm ON pm.id = r.payment_method_id LEFT JOIN LATERAL ( SELECT pay.failure_reason, pay.failure_code, pay.updated_at FROM payments pay WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE'::payment_purpose AND pay.status = 'FAILED'::payment_status ORDER BY pay.created_at DESC LIMIT 1) p ON true WHERE r.state = 'UNPAID'::rental_state`,
);

export const vDailyRevenue = pgView('v_daily_revenue', {
  day: date(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rides: bigint({ mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rideRevenue: bigint('ride_revenue', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rideSeconds: bigint('ride_seconds', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  topups: bigint({ mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refunds: bigint({ mode: 'number' }),
}).as(
  sql`WITH rides AS ( SELECT (rentals.ended_at AT TIME ZONE 'Europe/Warsaw'::text)::date AS day, count(*) AS rides, sum(rentals.total_amount)::bigint AS ride_revenue, sum(rentals.ride_seconds) AS ride_seconds FROM rentals WHERE (rentals.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state])) AND rentals.ended_at IS NOT NULL GROUP BY ((rentals.ended_at AT TIME ZONE 'Europe/Warsaw'::text)::date) ), topups AS ( SELECT (payments.created_at AT TIME ZONE 'Europe/Warsaw'::text)::date AS day, sum(payments.amount)::bigint AS topups FROM payments WHERE payments.purpose = 'TOPUP'::payment_purpose AND (payments.status = ANY (ARRAY['SUCCEEDED'::payment_status, 'REFUNDED'::payment_status])) GROUP BY ((payments.created_at AT TIME ZONE 'Europe/Warsaw'::text)::date) ), refunds AS ( SELECT (refunds_1.created_at AT TIME ZONE 'Europe/Warsaw'::text)::date AS day, sum(refunds_1.amount)::bigint AS refunds FROM public.refunds refunds_1 WHERE refunds_1.status = 'SUCCEEDED'::refund_status AND refunds_1.rental_id IS NOT NULL GROUP BY ((refunds_1.created_at AT TIME ZONE 'Europe/Warsaw'::text)::date) ) SELECT day, COALESCE(rides.rides, 0::bigint) AS rides, COALESCE(rides.ride_revenue, 0::bigint) AS ride_revenue, COALESCE(rides.ride_seconds, 0::bigint) AS ride_seconds, COALESCE(topups.topups, 0::bigint) AS topups, COALESCE(refunds.refunds, 0::bigint) AS refunds FROM rides FULL JOIN topups USING (day) FULL JOIN refunds USING (day)`,
);

export const vReceiptList = pgView('v_receipt_list', {
  id: uuid(),
  number: text(),
  kind: receiptKind(),
  issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
  userId: uuid('user_id'),
  buyerName: text('buyer_name'),
  buyerPhone: text('buyer_phone'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  paymentId: uuid('payment_id'),
  refundId: uuid('refund_id'),
  paymentSource: paymentSource('payment_source'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalAmount: bigint('total_amount', { mode: 'number' }),
  currency: char({ length: 3 }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  vatAmount: bigint('vat_amount', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  netAmount: bigint('net_amount', { mode: 'number' }),
  vatRate: numeric('vat_rate'),
  correctsReceiptId: uuid('corrects_receipt_id'),
  correctsNumber: text('corrects_number'),
  corrections: integer(),
}).as(
  sql`SELECT rc.id, rc.number, rc.kind, rc.issued_at, rc.user_id, rc.buyer_name, rc.buyer_phone, rc.rental_id, r.number AS rental_number, rc.payment_id, rc.refund_id, rc.payment_source, pm.brand AS card_brand, pm.last4 AS card_last4, rc.total_amount, rc.currency, COALESCE(v.vat_amount, 0::bigint) AS vat_amount, rc.total_amount - COALESCE(v.vat_amount, 0::bigint) AS net_amount, v.vat_rate, rc.corrects_receipt_id, o.number AS corrects_number, ( SELECT count(*)::integer AS count FROM receipts c WHERE c.corrects_receipt_id = rc.id) AS corrections FROM receipts rc LEFT JOIN rentals r ON r.id = rc.rental_id LEFT JOIN payments p ON p.id = rc.payment_id LEFT JOIN payment_methods pm ON rc.payment_source = 'CARD'::payment_source AND pm.id = COALESCE(p.payment_method_id, r.payment_method_id) LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id LEFT JOIN LATERAL ( SELECT max(i.vat_rate) AS vat_rate, fn_vat_from_gross(sum(i.amount)::bigint, max(i.vat_rate)) AS vat_amount FROM receipt_items i WHERE i.receipt_id = rc.id) v ON true`,
);

export const vRentalDetails = pgView('v_rental_details', {
  id: uuid(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  state: rentalState(),
  paymentSource: paymentSource('payment_source'),
  reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'date' }),
  reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  rideSeconds: integer('ride_seconds'),
  pauseSeconds: integer('pause_seconds'),
  distanceM: integer('distance_m'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalAmount: bigint('total_amount', { mode: 'number' }),
  userId: uuid('user_id'),
  userPhone: text('user_phone'),
  userName: text('user_name'),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  tariffId: uuid('tariff_id'),
  tariffVersion: integer('tariff_version'),
  endZoneId: uuid('end_zone_id'),
  endZoneCode: text('end_zone_code'),
  endZoneName: text('end_zone_name'),
  hasParkingPhoto: boolean('has_parking_photo'),
  cardPaymentStatus: paymentStatus('card_payment_status'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  walletCharge: bigint('wallet_charge', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  scooterOnline: boolean('scooter_online'),
  scooterBatteryPct: smallint('scooter_battery_pct'),
  elapsedSeconds: integer('elapsed_seconds'),
  hasProblem: boolean('has_problem'),
  userStatus: userStatus('user_status'),
  pendingCommand: commandType('pending_command'),
  settlement: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  paidAmount: bigint('paid_amount', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundedAmount: bigint('refunded_amount', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundPendingAmount: bigint('refund_pending_amount', { mode: 'number' }),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
  paymentMethodId: uuid('payment_method_id'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  cardFailureReason: text('card_failure_reason'),
  cardPaymentId: uuid('card_payment_id'),
  endMode: rentalEndMode('end_mode'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  towingFee: bigint('towing_fee', { mode: 'number' }),
  parkingPhotoRequired: boolean('parking_photo_required'),
  parkingPhotoDeleted: boolean('parking_photo_deleted'),
  billingStoppedAt: timestamp('billing_stopped_at', { withTimezone: true, mode: 'date' }),
  movedAfterEnd: boolean('moved_after_end'),
}).as(
  sql`SELECT r.id, r.number, r.state, r.payment_source, r.reserved_at, r.reservation_expires_at, r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount, r.user_id, u.phone AS user_phone, u.name AS user_name, r.scooter_id, s.number AS scooter_number, r.tariff_id, t.version AS tariff_version, r.end_zone_id, ez.code AS end_zone_code, ez.name AS end_zone_name, r.parking_photo_id IS NOT NULL AS has_parking_photo, p.status AS card_payment_status, l.amount AS wallet_charge, r.created_at, r.updated_at, s.online AS scooter_online, s.battery_pct AS scooter_battery_pct, CASE WHEN r.started_at IS NULL THEN 0 ELSE floor(EXTRACT(epoch FROM COALESCE(r.ended_at, now()) - r.started_at))::integer END AS elapsed_seconds, r.state = 'UNLOCK_FAILED'::rental_state OR (r.state = ANY (ARRAY['UNLOCKING'::rental_state, 'ACTIVE'::rental_state, 'PAUSED'::rental_state, 'ENDING'::rental_state])) AND (NOT s.online OR (EXISTS ( SELECT 1 FROM rental_events fe WHERE fe.rental_id = r.id AND (fe.type::text = ANY (ARRAY['PAUSE_FAILED'::text, 'RESUME_FAILED'::text, 'LOCK_FAILED'::text])) AND fe.created_at >= COALESCE(( SELECT max(se.created_at) AS max FROM rental_events se WHERE se.rental_id = r.id AND se.type = 'STATE_CHANGED'::rental_event_type AND se.to_state <> 'ENDING'::rental_state), '-infinity'::timestamp with time zone)))) AS has_problem, u.status AS user_status, ( SELECT c.type FROM scooter_commands c WHERE c.rental_id = r.id AND c.status = 'SENT'::command_status AND (c.type = ANY (ARRAY['LOCK'::command_type, 'UNLOCK'::command_type]))) AS pending_command, fn_rental_settlement(r.id) AS settlement, fn_rental_paid_amount(r.id) AS paid_amount, ( SELECT COALESCE(sum(f.amount), 0::numeric)::bigint AS "coalesce" FROM refunds f WHERE f.rental_id = r.id AND f.status = 'SUCCEEDED'::refund_status) AS refunded_amount, ( SELECT COALESCE(sum(f.amount), 0::numeric)::bigint AS "coalesce" FROM refunds f WHERE f.rental_id = r.id AND f.status = 'PENDING'::refund_status) AS refund_pending_amount, rc.id AS receipt_id, rc.number AS receipt_number, r.payment_method_id, pm.brand AS card_brand, pm.last4 AS card_last4, p.failure_reason AS card_failure_reason, p.id AS card_payment_id, r.end_mode, r.towing_fee, (r.end_mode = ANY (ARRAY['CUSTOMER_OFFLINE'::rental_end_mode, 'UNCONFIRMED'::rental_end_mode])) AND r.parking_photo_id IS NULL AS parking_photo_required, COALESCE(pf.status = 'DELETED'::file_status, false) AS parking_photo_deleted, ( SELECT min(e.created_at) AS min FROM rental_events e WHERE e.rental_id = r.id AND e.type::text = 'BILLING_STOPPED'::text) AS billing_stopped_at, (EXISTS ( SELECT 1 FROM rental_events e WHERE e.rental_id = r.id AND e.type::text = 'MOVED_AFTER_END'::text)) AS moved_after_end FROM rentals r JOIN users u ON u.id = r.user_id JOIN scooters s ON s.id = r.scooter_id JOIN tariffs t ON t.id = r.tariff_id LEFT JOIN zones ez ON ez.id = r.end_zone_id LEFT JOIN files pf ON pf.id = r.parking_photo_id LEFT JOIN receipts rc ON rc.rental_id = r.id AND rc.kind = 'SALE'::receipt_kind LEFT JOIN LATERAL ( SELECT pay.id, pay.status, pay.failure_reason, pay.payment_method_id FROM payments pay WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE'::payment_purpose ORDER BY pay.created_at DESC LIMIT 1) p ON true LEFT JOIN payment_methods pm ON pm.id = COALESCE(p.payment_method_id, r.payment_method_id) LEFT JOIN wallet_ledger l ON l.rental_id = r.id AND l.type = 'RIDE_CHARGE'::ledger_entry_type`,
);

export const vWalletLedger = pgView('v_wallet_ledger', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  type: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  amount: bigint({ mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  balanceAfter: bigint('balance_after', { mode: 'number' }),
  reason: ledgerReason(),
  note: text(),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  paymentId: uuid('payment_id'),
  paymentMethod: paymentMethodKind('payment_method'),
  providerPaymentId: text('provider_payment_id'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  refundId: uuid('refund_id'),
  refundReason: refundReason('refund_reason'),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
}).as(
  sql`SELECT l.id, l.created_at, l.user_id, u.name AS user_name, u.phone AS user_phone, l.type::text AS type, l.amount, l.balance_after, l.reason, l.note, l.rental_id, r.number AS rental_number, l.payment_id, p.method AS payment_method, p.provider_payment_id, pm.brand AS card_brand, pm.last4 AS card_last4, l.refund_id, f.reason AS refund_reason, l.staff_id, s.name AS staff_name, COALESCE(rc.id, rcf.id) AS receipt_id, COALESCE(rc.number, rcf.number) AS receipt_number FROM wallet_ledger l JOIN users u ON u.id = l.user_id LEFT JOIN rentals r ON r.id = l.rental_id LEFT JOIN payments p ON p.id = l.payment_id LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id LEFT JOIN refunds f ON f.id = l.refund_id LEFT JOIN staff s ON s.id = l.staff_id LEFT JOIN receipts rc ON rc.rental_id = l.rental_id AND rc.kind = 'SALE'::receipt_kind AND (l.type::text = ANY (ARRAY['RIDE_CHARGE'::text, 'TOWING_FEE'::text])) LEFT JOIN receipts rcf ON rcf.refund_id = l.refund_id`,
);

export const vTicketList = pgView('v_ticket_list', {
  id: uuid(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  status: ticketStatus(),
  urgent: boolean(),
  categories: ticketCategory(),
  source: ticketSource(),
  autoKind: ticketAutoKind('auto_kind'),
  description: text(),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  scooterStatus: scooterStatus('scooter_status'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  reportedBy: uuid('reported_by'),
  reporterName: text('reporter_name'),
  reporterPhone: text('reporter_phone'),
  assigneeId: uuid('assignee_id'),
  assigneeName: text('assignee_name'),
  photos: integer(),
  openTasks: integer('open_tasks'),
  serviceTaskId: uuid('service_task_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  serviceTaskNumber: bigint('service_task_number', { mode: 'number' }),
  serviceTaskStatus: serviceTaskStatus('service_task_status'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundedAmount: bigint('refunded_amount', { mode: 'number' }),
  customerReply: text('customer_reply'),
  customerReplyAt: timestamp('customer_reply_at', { withTimezone: true, mode: 'date' }),
  customerReplyReadAt: timestamp('customer_reply_read_at', { withTimezone: true, mode: 'date' }),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  ageSeconds: integer('age_seconds'),
}).as(
  sql`SELECT t.id, t.number, t.status, t.urgent, t.categories, t.source, t.auto_kind, t.description, t.scooter_id, s.number AS scooter_number, s.status AS scooter_status, t.rental_id, r.number AS rental_number, t.reported_by, u.name AS reporter_name, u.phone AS reporter_phone, t.assignee_id, a.name AS assignee_name, ( SELECT count(*)::integer AS count FROM ticket_photos p WHERE p.ticket_id = t.id) AS photos, ( SELECT count(*)::integer AS count FROM service_tasks x WHERE x.ticket_id = t.id AND (x.status = ANY (ARRAY['OPEN'::service_task_status, 'IN_PROGRESS'::service_task_status]))) AS open_tasks, lt.id AS service_task_id, lt.number AS service_task_number, lt.status AS service_task_status, ( SELECT COALESCE(sum(f.amount), 0::numeric)::bigint AS "coalesce" FROM refunds f WHERE f.ticket_id = t.id AND f.status = 'SUCCEEDED'::refund_status) AS refunded_amount, t.customer_reply, t.customer_reply_at, t.customer_reply_read_at, t.resolution_note, t.created_at, t.updated_at, t.resolved_at, t.version, floor(EXTRACT(epoch FROM now() - t.created_at))::integer AS age_seconds FROM tickets t JOIN scooters s ON s.id = t.scooter_id LEFT JOIN rentals r ON r.id = t.rental_id LEFT JOIN users u ON u.id = t.reported_by LEFT JOIN staff a ON a.id = t.assignee_id LEFT JOIN LATERAL ( SELECT x.id, x.number, x.status FROM service_tasks x WHERE x.ticket_id = t.id ORDER BY x.created_at DESC LIMIT 1) lt ON true`,
);

export const vServiceTaskList = pgView('v_service_task_list', {
  id: uuid(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  type: serviceTaskType(),
  status: serviceTaskStatus(),
  priority: taskPriority(),
  description: text(),
  resultNote: text('result_note'),
  cancelReason: text('cancel_reason'),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  scooterStatus: scooterStatus('scooter_status'),
  assigneeId: uuid('assignee_id'),
  assigneeName: text('assignee_name'),
  createdBy: uuid('created_by'),
  createdByName: text('created_by_name'),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
  overdue: boolean(),
  ticketId: uuid('ticket_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketNumber: bigint('ticket_number', { mode: 'number' }),
  ticketCategories: ticketCategory('ticket_categories'),
  targetZoneId: uuid('target_zone_id'),
  targetZoneCode: text('target_zone_code'),
  targetZoneName: text('target_zone_name'),
  targetLat: doublePrecision('target_lat'),
  targetLon: doublePrecision('target_lon'),
  partsCount: integer('parts_count'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  partsCost: bigint('parts_cost', { mode: 'number' }),
  cancelledBy: uuid('cancelled_by'),
  cancelledByName: text('cancelled_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT st.id, st.number, st.type, st.status, st.priority, st.description, st.result_note, st.cancel_reason, st.scooter_id, s.number AS scooter_number, s.status AS scooter_status, st.assignee_id, a.name AS assignee_name, st.created_by, c.name AS created_by_name, st.due_at, (st.status = ANY (ARRAY['OPEN'::service_task_status, 'IN_PROGRESS'::service_task_status])) AND st.due_at IS NOT NULL AND st.due_at < now() AS overdue, st.ticket_id, t.number AS ticket_number, t.categories AS ticket_categories, st.target_zone_id, z.code AS target_zone_code, z.name AS target_zone_name, st_y(st.target_point) AS target_lat, st_x(st.target_point) AS target_lon, COALESCE(pt.parts_count, 0) AS parts_count, COALESCE(pt.parts_cost, 0::numeric)::bigint AS parts_cost, st.cancelled_by, cb.name AS cancelled_by_name, st.created_at, st.started_at, st.completed_at, st.updated_at, st.version FROM service_tasks st JOIN scooters s ON s.id = st.scooter_id LEFT JOIN staff a ON a.id = st.assignee_id LEFT JOIN staff c ON c.id = st.created_by LEFT JOIN staff cb ON cb.id = st.cancelled_by LEFT JOIN tickets t ON t.id = st.ticket_id LEFT JOIN zones z ON z.id = st.target_zone_id LEFT JOIN LATERAL ( SELECT count(*)::integer AS parts_count, sum(p.quantity * p.unit_cost) AS parts_cost FROM service_task_parts p WHERE p.task_id = st.id) pt ON true`,
);

export const vServiceTaskParts = pgView('v_service_task_parts', {
  taskId: uuid('task_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  taskNumber: bigint('task_number', { mode: 'number' }),
  partId: uuid('part_id'),
  sku: text(),
  name: text(),
  quantity: integer(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unitCost: bigint('unit_cost', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  amount: bigint({ mode: 'number' }),
  stockQty: integer('stock_qty'),
}).as(
  sql`SELECT l.task_id, st.number AS task_number, l.part_id, p.sku, p.name, l.quantity, l.unit_cost, l.quantity * l.unit_cost AS amount, p.stock_qty FROM service_task_parts l JOIN service_tasks st ON st.id = l.task_id JOIN spare_parts p ON p.id = l.part_id`,
);

export const vSparePartList = pgView('v_spare_part_list', {
  id: uuid(),
  sku: text(),
  name: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unitCost: bigint('unit_cost', { mode: 'number' }),
  stockQty: integer('stock_qty'),
  minStockQty: integer('min_stock_qty'),
  belowMinimum: boolean('below_minimum'),
  active: boolean(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  used30D: integer('used_30d'),
  lastMovementAt: timestamp('last_movement_at', { withTimezone: true, mode: 'date' }),
  lastMovementKind: partMovementKind('last_movement_kind'),
  lastMovementDelta: integer('last_movement_delta'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  lastMovementTaskNumber: bigint('last_movement_task_number', { mode: 'number' }),
  usedInTasks: boolean('used_in_tasks'),
}).as(
  sql`SELECT p.id, p.sku, p.name, p.unit_cost, p.stock_qty, p.min_stock_qty, p.stock_qty < p.min_stock_qty AS below_minimum, p.active, p.created_at, p.updated_at, p.version, COALESCE(( SELECT - sum(m.delta) FROM spare_part_movements m WHERE m.part_id = p.id AND (m.kind = ANY (ARRAY['USE'::part_movement_kind, 'RETURN'::part_movement_kind])) AND m.created_at >= (now() - '30 days'::interval)), 0::bigint)::integer AS used_30d, lm.created_at AS last_movement_at, lm.kind AS last_movement_kind, lm.delta AS last_movement_delta, lm.task_number AS last_movement_task_number, (EXISTS ( SELECT 1 FROM service_task_parts l WHERE l.part_id = p.id)) AS used_in_tasks FROM spare_parts p LEFT JOIN LATERAL ( SELECT m.created_at, m.kind, m.delta, st.number AS task_number FROM spare_part_movements m LEFT JOIN service_tasks st ON st.id = m.task_id WHERE m.part_id = p.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) lm ON true`,
);

export const vSparePartMovements = pgView('v_spare_part_movements', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  partId: uuid('part_id'),
  sku: text(),
  partName: text('part_name'),
  kind: partMovementKind(),
  delta: integer(),
  stockAfter: integer('stock_after'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unitCost: bigint('unit_cost', { mode: 'number' }),
  taskId: uuid('task_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  taskNumber: bigint('task_number', { mode: 'number' }),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  document: text(),
  reason: partAdjustReason(),
  note: text(),
}).as(
  sql`SELECT m.id, m.created_at, m.part_id, p.sku, p.name AS part_name, m.kind, m.delta, m.stock_after, m.unit_cost, m.task_id, st.number AS task_number, st.scooter_id, s.number AS scooter_number, m.staff_id, sf.name AS staff_name, m.document, m.reason, m.note FROM spare_part_movements m JOIN spare_parts p ON p.id = m.part_id LEFT JOIN service_tasks st ON st.id = m.task_id LEFT JOIN scooters s ON s.id = st.scooter_id LEFT JOIN staff sf ON sf.id = m.staff_id`,
);

export const vNotificationTemplates = pgView('v_notification_templates', {
  id: uuid(),
  code: text(),
  channel: notificationChannel(),
  title: text(),
  body: text(),
  description: text(),
  version: integer(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  versions: integer(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }),
  sent30D: integer('sent_30d'),
}).as(
  sql`SELECT nt.id, nt.code, nt.channel, nt.title, nt.body, nt.description, nt.version, nt.created_at, nt.updated_at, nt.updated_by, s.name AS updated_by_name, ( SELECT count(*)::integer AS count FROM notification_template_versions v WHERE v.template_id = nt.id) AS versions, ( SELECT max(n.sent_at) AS max FROM notifications n WHERE n.template_code = nt.code AND n.channel = nt.channel AND n.status = 'SENT'::notification_status) AS last_sent_at, ( SELECT count(*)::integer AS count FROM notifications n WHERE n.template_code = nt.code AND n.channel = nt.channel AND n.created_at >= (now() - '30 days'::interval)) AS sent_30d FROM notification_templates nt LEFT JOIN staff s ON s.id = nt.updated_by`,
);

export const vNotificationTemplateVersions = pgView('v_notification_template_versions', {
  id: uuid(),
  templateId: uuid('template_id'),
  code: text(),
  channel: notificationChannel(),
  version: integer(),
  title: text(),
  body: text(),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  isCurrent: boolean('is_current'),
}).as(
  sql`SELECT v.id, v.template_id, nt.code, nt.channel, v.version, v.title, v.body, v.staff_id, s.name AS staff_name, v.created_at, v.version = nt.version AS is_current FROM notification_template_versions v JOIN notification_templates nt ON nt.id = v.template_id LEFT JOIN staff s ON s.id = v.staff_id`,
);

export const vNotificationList = pgView('v_notification_list', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  status: notificationStatus(),
  channel: notificationChannel(),
  templateCode: text('template_code'),
  templateVersion: integer('template_version'),
  title: text(),
  body: text(),
  error: text(),
  dedupeKey: text('dedupe_key'),
  providerRef: text('provider_ref'),
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  payload: jsonb(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  ticketId: uuid('ticket_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketNumber: bigint('ticket_number', { mode: 'number' }),
}).as(
  sql`SELECT n.id, n.created_at, n.sent_at, n.status, n.channel, n.template_code, n.template_version, n.title, n.body, n.error, n.dedupe_key, n.provider_ref, n.read_at, n.payload, n.user_id, u.name AS user_name, u.phone AS user_phone, n.rental_id, r.number AS rental_number, n.ticket_id, t.number AS ticket_number FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN rentals r ON r.id = n.rental_id LEFT JOIN tickets t ON t.id = n.ticket_id`,
);

export const vPushTokens = pgView('v_push_tokens', {
  id: uuid(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  platform: platform(),
  expoToken: text('expo_token'),
  sessionId: uuid('session_id'),
  sessionActive: boolean('session_active'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT pt.id, pt.user_id, u.name AS user_name, u.phone AS user_phone, pt.platform, pt.expo_token, pt.session_id, COALESCE(ss.revoked_at IS NULL AND ss.expires_at > now(), false) AS session_active, pt.created_at, pt.last_seen_at FROM push_tokens pt JOIN users u ON u.id = pt.user_id LEFT JOIN sessions ss ON ss.id = pt.session_id`,
);

export const vFileList = pgView('v_file_list', {
  id: uuid(),
  storageKey: text('storage_key'),
  purpose: filePurpose(),
  status: fileStatus(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  sha256: text(),
  originalName: text('original_name'),
  uploadedBy: uuid('uploaded_by'),
  uploadedByName: text('uploaded_by_name'),
  uploadedByStaff: uuid('uploaded_by_staff'),
  uploadedByStaffName: text('uploaded_by_staff_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  ticketId: uuid('ticket_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketNumber: bigint('ticket_number', { mode: 'number' }),
  attached: boolean(),
}).as(
  sql`SELECT f.id, f.storage_key, f.purpose, f.status, f.content_type, f.size_bytes, f.sha256, f.original_name, f.uploaded_by, u.name AS uploaded_by_name, f.uploaded_by_staff, sf.name AS uploaded_by_staff_name, f.created_at, f.deleted_at, pr.id AS rental_id, pr.number AS rental_number, tp.ticket_id, tk.number AS ticket_number, pr.id IS NOT NULL OR tp.ticket_id IS NOT NULL AS attached FROM files f LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN staff sf ON sf.id = f.uploaded_by_staff LEFT JOIN LATERAL ( SELECT r.id, r.number FROM rentals r WHERE r.parking_photo_id = f.id LIMIT 1) pr ON true LEFT JOIN LATERAL ( SELECT p.ticket_id FROM ticket_photos p WHERE p.file_id = f.id LIMIT 1) tp ON true LEFT JOIN tickets tk ON tk.id = tp.ticket_id`,
);

export const vTicketTimeline = pgView('v_ticket_timeline', {
  ticketId: uuid('ticket_id'),
  at: timestamp({ withTimezone: true, mode: 'date' }),
  kind: text(),
  kindOrder: integer('kind_order'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  seq: bigint({ mode: 'number' }),
  ref: text(),
  action: text(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  actor: text(),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  data: jsonb(),
}).as(
  sql`SELECT t.id AS ticket_id, t.created_at AS at, 'CREATED'::text AS kind, 0 AS kind_order, 0::bigint AS seq, t.number::text AS ref, 'ticket.created'::text AS action, 'ticket'::text AS entity_type, t.id AS entity_id, 'CUSTOMER'::text AS actor, NULL::uuid AS staff_id, NULL::text AS staff_name, jsonb_build_object('categories', t.categories, 'rentalId', t.rental_id, 'photos', ( SELECT count(*) AS count FROM ticket_photos p WHERE p.ticket_id = t.id)) AS data FROM tickets t WHERE t.source = 'USER'::ticket_source UNION ALL SELECT x.ticket_id, a.created_at AS at, 'AUDIT'::text AS kind, 1 AS kind_order, a.id AS seq, a.id::text AS ref, a.action, a.entity_type, a.entity_id, a.actor::text AS actor, a.staff_id, s.name AS staff_name, a.data FROM ( SELECT t.id AS ticket_id, 'ticket'::text AS entity_type, t.id AS entity_id FROM tickets t UNION ALL SELECT st.ticket_id, 'service_task'::text, st.id FROM service_tasks st WHERE st.ticket_id IS NOT NULL) x JOIN audit_log a ON a.entity_type = x.entity_type AND a.entity_id = x.entity_id LEFT JOIN staff s ON s.id = a.staff_id UNION ALL SELECT f.ticket_id, a.created_at AS at, 'AUDIT'::text AS kind, 1 AS kind_order, a.id AS seq, a.id::text AS ref, a.action, a.entity_type, a.entity_id, a.actor::text AS actor, a.staff_id, s.name AS staff_name, a.data FROM refunds f JOIN audit_log a ON a.entity_type = 'rental'::text AND a.entity_id = f.rental_id AND (a.data ->> 'refundId'::text) = f.id::text LEFT JOIN staff s ON s.id = a.staff_id WHERE f.ticket_id IS NOT NULL UNION ALL SELECT f.ticket_id, f.updated_at AS at, 'REFUND'::text AS kind, 2 AS kind_order, 0 AS seq, f.id::text AS ref, 'refund.'::text || lower(f.status::text) AS action, 'refund'::text AS entity_type, f.id AS entity_id, 'SYSTEM'::text AS actor, NULL::uuid AS staff_id, NULL::text AS staff_name, jsonb_build_object('amount', f.amount, 'source', f.source, 'status', f.status, 'failureReason', f.failure_reason) AS data FROM refunds f WHERE f.ticket_id IS NOT NULL AND f.status <> 'PENDING'::refund_status UNION ALL SELECT n.ticket_id, COALESCE(n.sent_at, n.created_at) AS at, 'NOTIFICATION'::text AS kind, 3 AS kind_order, n.id AS seq, n.id::text AS ref, n.template_code AS action, 'notification'::text AS entity_type, NULL::uuid AS entity_id, 'SYSTEM'::text AS actor, NULL::uuid AS staff_id, NULL::text AS staff_name, jsonb_build_object('status', n.status, 'channel', n.channel, 'templateVersion', n.template_version, 'error', n.error) AS data FROM notifications n WHERE n.ticket_id IS NOT NULL`,
);
