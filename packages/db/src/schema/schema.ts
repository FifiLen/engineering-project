// Plik generowany przez `pnpm db:pull` na podstawie bazy. Nie edytuj ręcznie.
import {
  pgTable,
  index,
  uniqueIndex,
  foreignKey,
  check,
  uuid,
  text,
  timestamp,
  unique,
  integer,
  boolean,
  smallint,
  geometry,
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
export const commandSource = pgEnum('command_source', ['STAFF', 'RENTAL', 'ZONE', 'SYSTEM']);
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
export const consentSource = pgEnum('consent_source', ['REGISTRATION', 'APP', 'PANEL']);
export const consentType = pgEnum('consent_type', ['TERMS', 'PRIVACY', 'MARKETING', 'AGE']);
export const contentClient = pgEnum('content_client', ['WEB', 'MOBILE', 'ADMIN']);
export const contentStatus = pgEnum('content_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const documentFormat = pgEnum('document_format', ['DOCX', 'PDF']);
export const documentType = pgEnum('document_type', [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
  'SCOOTER_LABEL',
]);
export const filePurpose = pgEnum('file_purpose', [
  'PARKING_PHOTO',
  'TICKET_PHOTO',
  'MEDIA',
  'DOCUMENT_TEMPLATE',
  'GENERATED_DOCUMENT',
  'REPORT_EXPORT',
  'DATA_EXPORT',
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
export const otpPurpose = pgEnum('otp_purpose', ['LOGIN', 'REGISTER']);
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
export const sessionPlatform = pgEnum('session_platform', ['IOS', 'ANDROID', 'WEB']);
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
    source: consentSource(),
    revokedByStaff: uuid('revoked_by_staff'),
  },
  (table) => [
    index('consents_marketing_idx')
      .using('btree', table.acceptedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(type = 'MARKETING'::consent_type)`),
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
      columns: [table.revokedByStaff],
      foreignColumns: [staff.id],
      name: 'consents_revoked_by_staff_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'consents_user_id_fkey',
    }),
    check(
      'consents_revoked_by_staff',
      sql`(revoked_by_staff IS NULL) OR ((revoked_at IS NOT NULL) AND (type = 'MARKETING'::consent_type))`,
    ),
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
    platform: sessionPlatform(),
    appVersion: text('app_version'),
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
    check('sessions_app_version', sql`(btrim(app_version) <> ''::text) AND (char_length(app_version) <= 32)`),
    check('sessions_replaced_is_revoked', sql`(replaced_by IS NULL) OR (revoked_at IS NOT NULL)`),
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
    index('users_created_idx').using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops')),
    unique('users_phone_key').on(table.phone),
    unique('users_email_key').on(table.email),
    check(
      'users_block_consistent',
      sql`((status = 'BLOCKED'::user_status) = (blocked_at IS NOT NULL)) AND ((blocked_at IS NULL) = (blocked_reason IS NULL))`,
    ),
    check('users_check', sql`(status <> 'DELETED'::user_status) OR ((phone IS NULL) AND (email IS NULL))`),
  ],
);

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
    purpose: otpPurpose().default('LOGIN').notNull(),
  },
  (table) => [
    index('otp_codes_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('otp_codes_phone_idx').using(
      'btree',
      table.phone.asc().nullsLast().op('text_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
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
    index('saved_places_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'saved_places_user_id_fkey',
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
    source: commandSource().notNull(),
    zoneId: uuid('zone_id'),
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
    index('scooter_commands_sent_idx').using('btree', table.sentAt.desc().nullsFirst().op('timestamptz_ops')),
    index('scooter_commands_zone_idx')
      .using('btree', table.zoneId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(zone_id IS NOT NULL)`),
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
    foreignKey({
      columns: [table.zoneId],
      foreignColumns: [zones.id],
      name: 'scooter_commands_zone_id_fkey',
    }),
    check('scooter_commands_expiry_after_sent', sql`(expires_at IS NULL) OR (expires_at > sent_at)`),
    check('scooter_commands_staff_source', sql`(source = 'STAFF'::command_source) = (issued_by_staff IS NOT NULL)`),
    check('scooter_commands_zone_source', sql`(zone_id IS NULL) OR (source = 'ZONE'::command_source)`),
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
    index('payments_succeeded_created_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = ANY (ARRAY['SUCCEEDED'::payment_status, 'REFUNDED'::payment_status]))`),
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
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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
    index('rental_events_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('rental_events_rental_idx').using(
      'btree',
      table.rentalId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('rental_events_zone_exit_idx')
      .using(
        'btree',
        table.rentalId.asc().nullsLast().op('uuid_ops'),
        table.zoneId.asc().nullsLast().op('uuid_ops'),
        table.createdAt.asc().nullsLast().op('timestamptz_ops'),
      )
      .where(sql`(type = 'ZONE_EXITED'::rental_event_type)`),
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
    index('rentals_ended_idx')
      .using('btree', table.endedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(ended_at IS NOT NULL)`),
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
    index('rentals_started_idx')
      .using('btree', table.startedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(started_at IS NOT NULL)`),
    index('rentals_state_created_idx').using(
      'btree',
      table.state.asc().nullsLast().op('enum_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('rentals_unpaid_idx')
      .using('btree', table.endedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(state = 'UNPAID'::rental_state)`),
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
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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
    index('wallet_ledger_created_idx').using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops')),
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
    index('wallet_ledger_user_created_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
      table.id.desc().nullsFirst().op('int8_ops'),
    ),
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
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedBy: uuid('updated_by'),
    version: integer().default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'permissions_updated_by_fkey',
    }),
    check('permissions_code_check', sql`code ~ '^[a-z_]+\.[a-z_]+$'::text`),
    check('permissions_description_check', sql`(btrim(description) <> ''::text) AND (char_length(description) <= 160)`),
  ],
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
    name: text().notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
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
    check('media_assets_alt_text_length', sql`(char_length(alt_text) >= 3) AND (char_length(alt_text) <= 250)`),
    check('media_assets_caption_length', sql`(caption IS NULL) OR (char_length(caption) <= 200)`),
    check('media_assets_key_check', sql`key ~ '^[a-z0-9_.-]+$'::text`),
    check('media_assets_name_check', sql`(btrim(name) <> ''::text) AND (char_length(name) <= 200)`),
    check('media_assets_system_key', sql`is_system = (key ~~ 'scooter.%'::text)`),
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
    version: integer().default(1).notNull(),
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
    check('report_definitions_description_check', sql`char_length(description) <= 300`),
    check('report_definitions_formats_check', sql`cardinality(formats) > 0`),
    check('report_definitions_name_check', sql`(btrim(name) <> ''::text) AND (char_length(name) <= 80)`),
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
    status: contentStatus().default('DRAFT').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    position: integer().default(0).notNull(),
    icon: text(),
  },
  (table) => [
    index('content_blocks_client_idx').using(
      'btree',
      table.client.asc().nullsLast().op('enum_ops'),
      table.key.asc().nullsLast().op('text_ops'),
      table.position.asc().nullsLast().op('int4_ops'),
    ),
    index('content_blocks_media_idx')
      .using('btree', table.mediaId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(media_id IS NOT NULL)`),
    foreignKey({
      columns: [table.mediaId],
      foreignColumns: [mediaAssets.id],
      name: 'content_blocks_media_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'content_blocks_updated_by_fkey',
    }),
    unique('content_blocks_key_position').on(table.key, table.position),
    check('content_blocks_check', sql`(cta_label IS NULL) = (cta_url IS NULL)`),
    check(
      'content_blocks_cta_url',
      sql`(char_length(cta_url) <= 2000) AND (cta_url !~ '[[:cntrl:]]'::text) AND (cta_url ~ '^(https://[^/[:space:]\\][^[:space:]\\]*|mailto:[^[:space:]\\]+|tel:\+?[0-9][0-9-]*|#[^[:space:]\\]*|/([^/[:space:]\\][^[:space:]\\]*)?)$'::text)`,
    ),
    check('content_blocks_has_content', sql`("position" = 0) OR (num_nonnulls(title, body_md, media_id) > 0)`),
    check(
      'content_blocks_icon',
      sql`icon = ANY (ARRAY['rider-single'::text, 'bike-lane'::text, 'parking'::text, 'helmet'::text, 'no-alcohol'::text, 'map'::text, 'scan'::text, 'wallet'::text, 'battery'::text, 'zone-slow'::text, 'zone-no-ride'::text, 'phone'::text])`,
    ),
    check('content_blocks_icon_item', sql`(icon IS NULL) OR ("position" > 0)`),
    check('content_blocks_key_check', sql`key ~ '^[a-z0-9_.-]+$'::text`),
    check('content_blocks_key_client', sql`key ~~ (lower((client)::text) || '.%'::text)`),
    check('content_blocks_position_check', sql`"position" >= 0`),
  ],
);

export const faqItems = pgTable(
  'faq_items',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    question: text().notNull(),
    answerMd: text('answer_md').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    status: contentStatus().default('DRAFT').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
    categoryId: uuid('category_id').notNull(),
    showOnWeb: boolean('show_on_web').default(true).notNull(),
    showInApp: boolean('show_in_app').default(true).notNull(),
  },
  (table) => [
    index('faq_items_category_idx').using(
      'btree',
      table.categoryId.asc().nullsLast().op('uuid_ops'),
      table.sortOrder.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [faqCategories.id],
      name: 'faq_items_category_id_fkey',
    }),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'faq_items_updated_by_fkey',
    }),
    check('faq_items_visible_somewhere', sql`show_on_web OR show_in_app`),
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
    dataAsOf: timestamp('data_as_of', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code'),
    rowCount: integer('row_count'),
    pageCount: integer('page_count'),
    fileDeletedAt: timestamp('file_deleted_at', { withTimezone: true, mode: 'date' }),
    retryOf: uuid('retry_of'),
  },
  (table) => [
    index('report_runs_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('report_runs_open_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = ANY (ARRAY['QUEUED'::job_status, 'RUNNING'::job_status]))`),
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
    index('report_runs_retention_idx')
      .using('btree', table.finishedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`((status = 'SUCCEEDED'::job_status) AND (file_deleted_at IS NULL))`),
    index('report_runs_retry_idx')
      .using('btree', table.retryOf.asc().nullsLast().op('uuid_ops'))
      .where(sql`(retry_of IS NOT NULL)`),
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
    foreignKey({
      columns: [table.retryOf],
      foreignColumns: [table.id],
      name: 'report_runs_retry_of_fkey',
    }),
    check('report_runs_check', sql`(status <> 'SUCCEEDED'::job_status) OR (file_id IS NOT NULL)`),
    check('report_runs_counts', sql`(row_count >= 0) AND (page_count > 0)`),
    check('report_runs_data_as_of', sql`(status <> 'SUCCEEDED'::job_status) OR (data_as_of IS NOT NULL)`),
    check('report_runs_error_code', sql`error_code ~ '^[A-Z_]+$'::text`),
    check('report_runs_failed_code', sql`(status <> 'FAILED'::job_status) OR (error_code IS NOT NULL)`),
    check('report_runs_file_deleted', sql`(file_deleted_at IS NULL) OR (status = 'SUCCEEDED'::job_status)`),
    check(
      'report_runs_finished',
      sql`(status = ANY (ARRAY['SUCCEEDED'::job_status, 'FAILED'::job_status])) = (finished_at IS NOT NULL)`,
    ),
    check('report_runs_format_check', sql`format <> 'CSV'::report_format`),
    check('report_runs_retry_other', sql`retry_of <> id`),
  ],
);

export const news = pgTable(
  'news',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    lead: text().notNull(),
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
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('news_media_idx')
      .using('btree', table.mediaId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(media_id IS NOT NULL)`),
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
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'news_updated_by_fkey',
    }),
    unique('news_slug_key').on(table.slug),
    check('news_check', sql`(status <> 'PUBLISHED'::content_status) OR (publish_from IS NOT NULL)`),
    check('news_check1', sql`(publish_to IS NULL) OR (publish_from IS NULL) OR (publish_to > publish_from)`),
    check('news_first_published', sql`(status <> 'PUBLISHED'::content_status) OR (first_published_at IS NOT NULL)`),
    check('news_lead_length', sql`(char_length(lead) >= 1) AND (char_length(lead) <= 280)`),
    check('news_slug_check', sql`slug ~ '^[a-z0-9-]+$'::text`),
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
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
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
    check('document_templates_deactivated', sql`(deactivated_at IS NULL) = active`),
    check('document_templates_not_built_in', sql`(document_type)::text <> 'SCOOTER_LABEL'::text`),
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
    index('scooter_models_photo_media_idx')
      .using('btree', table.photoMediaId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(photo_media_id IS NOT NULL)`),
    foreignKey({
      columns: [table.photoMediaId],
      foreignColumns: [mediaAssets.id],
      name: 'scooter_models_photo_media_id_fkey',
    }).onDelete('restrict'),
    unique('scooter_models_code_key').on(table.code),
    check('scooter_models_battery_wh_check', sql`battery_wh > 0`),
    check('scooter_models_max_speed_kmh_check', sql`max_speed_kmh > 0`),
    check('scooter_models_range_km_check', sql`range_km > 0`),
    check('scooter_models_weight_kg_check', sql`weight_kg > (0)::numeric`),
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
    uploadedBy: uuid('uploaded_by'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }),
    activatedBy: uuid('activated_by'),
    warnings: jsonb().default([]).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    uncompressedBytes: bigint('uncompressed_bytes', { mode: 'number' }).notNull(),
    previewFileId: uuid('preview_file_id'),
  },
  (table) => [
    uniqueIndex('document_template_versions_one_active')
      .using('btree', table.templateId.asc().nullsLast().op('uuid_ops'))
      .where(sql`is_active`),
    foreignKey({
      columns: [table.activatedBy],
      foreignColumns: [staff.id],
      name: 'document_template_versions_activated_by_fkey',
    }),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'document_template_versions_file_id_fkey',
    }),
    foreignKey({
      columns: [table.previewFileId],
      foreignColumns: [files.id],
      name: 'document_template_versions_preview_file_id_fkey',
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
    check('document_template_versions_activated_by', sql`(activated_by IS NULL) OR (activated_at IS NOT NULL)`),
    check('document_template_versions_active_activated', sql`(NOT is_active) OR (activated_at IS NOT NULL)`),
    check('document_template_versions_size_bytes_check', sql`size_bytes > 0`),
    check('document_template_versions_uncompressed_bytes_check', sql`uncompressed_bytes > 0`),
    check('document_template_versions_version_no_check', sql`version_no > 0`),
    check('document_template_versions_warnings_check', sql`jsonb_typeof(warnings) = 'array'::text`),
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
    index('receipts_issued_idx').using('btree', table.issuedAt.asc().nullsLast().op('timestamptz_ops')),
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
    index('service_tasks_completed_idx')
      .using('btree', table.completedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(completed_at IS NOT NULL)`),
    index('service_tasks_created_idx').using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops')),
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
    replacedBy: uuid('replaced_by'),
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
      columns: [table.replacedBy],
      foreignColumns: [table.id],
      name: 'staff_invitations_replaced_by_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'staff_invitations_staff_id_fkey',
    }),
    unique('staff_invitations_token_hash_key').on(table.tokenHash),
    check('staff_invitations_check', sql`num_nonnulls(accepted_at, revoked_at) <= 1`),
    check('staff_invitations_check1', sql`expires_at > created_at`),
    check('staff_invitations_replaced_is_revoked', sql`(replaced_by IS NULL) OR (revoked_at IS NOT NULL)`),
    check('staff_invitations_replaced_other', sql`replaced_by <> id`),
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
    remembered: boolean().default(false).notNull(),
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
    index('refunds_succeeded_created_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'SUCCEEDED'::refund_status)`),
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
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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
    index('tickets_created_idx').using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops')),
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
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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
    width: integer(),
    height: integer(),
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
    check(
      'files_dimensions',
      sql`((width IS NULL) = (height IS NULL)) AND ((width IS NULL) OR ((width > 0) AND (height > 0)))`,
    ),
    check('files_one_uploader', sql`num_nonnulls(uploaded_by, uploaded_by_staff) <= 1`),
    check('files_sha256_check', sql`sha256 ~ '^[0-9a-f]{64}$'::text`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
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

export const scooterStatusHistory = pgTable(
  'scooter_status_history',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
      name: 'scooter_status_history_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 9223372036854775807,
      cache: 1,
    }),
    scooterId: uuid('scooter_id').notNull(),
    status: scooterStatus().notNull(),
    online: boolean().notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('scooter_status_history_one_open')
      .using('btree', table.scooterId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(valid_to IS NULL)`),
    index('scooter_status_history_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('uuid_ops'),
      table.validFrom.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'scooter_status_history_scooter_id_fkey',
    }).onDelete('cascade'),
    check('scooter_status_history_range', sql`valid_to >= valid_from`),
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

export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    documentType: documentType('document_type').notNull(),
    templateVersionId: uuid('template_version_id'),
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
    format: documentFormat().notNull(),
    entityLabel: text('entity_label').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code'),
    filesDeletedAt: timestamp('files_deleted_at', { withTimezone: true, mode: 'date' }),
    retryOf: uuid('retry_of'),
    customerDataVisible: boolean('customer_data_visible').default(false).notNull(),
  },
  (table) => [
    index('generated_documents_created_idx').using('btree', table.createdAt.desc().nullsFirst().op('timestamptz_ops')),
    index('generated_documents_entity_idx').using(
      'btree',
      table.documentType.asc().nullsLast().op('timestamptz_ops'),
      table.entityRef.asc().nullsLast().op('enum_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    index('generated_documents_open_idx')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = ANY (ARRAY['QUEUED'::job_status, 'RUNNING'::job_status]))`),
    uniqueIndex('generated_documents_receipt_reuse')
      .using(
        'btree',
        table.entityRef.asc().nullsLast().op('text_ops'),
        table.templateVersionId.asc().nullsLast().op('uuid_ops'),
      )
      .where(
        sql`((document_type = 'RECEIPT'::document_type) AND (format = 'PDF'::document_format) AND (requested_by_user IS NOT NULL) AND (status <> 'FAILED'::job_status) AND (files_deleted_at IS NULL))`,
      ),
    index('generated_documents_retention_idx')
      .using('btree', table.finishedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(files_deleted_at IS NULL)`),
    index('generated_documents_template_version_idx')
      .using('btree', table.templateVersionId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(template_version_id IS NOT NULL)`),
    index('generated_documents_user_idx')
      .using(
        'btree',
        table.requestedByUser.asc().nullsLast().op('uuid_ops'),
        table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
      )
      .where(sql`(requested_by_user IS NOT NULL)`),
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
      columns: [table.retryOf],
      foreignColumns: [table.id],
      name: 'generated_documents_retry_of_fkey',
    }),
    foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [documentTemplateVersions.id],
      name: 'generated_documents_template_version_id_fkey',
    }),
    check('generated_documents_check', sql`num_nonnulls(requested_by_staff, requested_by_user) = 1`),
    check('generated_documents_docx_no_pdf', sql`(format = 'PDF'::document_format) OR (pdf_file_id IS NULL)`),
    check('generated_documents_entity_label', sql`btrim(entity_label) <> ''::text`),
    check('generated_documents_error_code', sql`error_code ~ '^[A-Z_]+$'::text`),
    check('generated_documents_failed_code', sql`(status <> 'FAILED'::job_status) OR (error_code IS NOT NULL)`),
    check('generated_documents_files_deleted', sql`(files_deleted_at IS NULL) OR (finished_at IS NOT NULL)`),
    check(
      'generated_documents_finished',
      sql`(status = ANY (ARRAY['SUCCEEDED'::job_status, 'FAILED'::job_status])) = (finished_at IS NOT NULL)`,
    ),
    check(
      'generated_documents_label_pdf',
      sql`((document_type)::text <> 'SCOOTER_LABEL'::text) OR ((format = 'PDF'::document_format) AND (docx_file_id IS NULL))`,
    ),
    check('generated_documents_retry_other', sql`retry_of <> id`),
    check(
      'generated_documents_succeeded_file',
      sql`(status <> 'SUCCEEDED'::job_status) OR
CASE format
    WHEN 'PDF'::document_format THEN (pdf_file_id IS NOT NULL)
    ELSE (docx_file_id IS NOT NULL)
END`,
    ),
    check(
      'generated_documents_template_version',
      sql`((document_type)::text = 'SCOOTER_LABEL'::text) = (template_version_id IS NULL)`,
    ),
  ],
);

export const faqCategories = pgTable(
  'faq_categories',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    version: integer().default(1).notNull(),
  },
  (table) => [
    uniqueIndex('faq_categories_name_key').using('btree', sql`lower(name)`),
    index('faq_categories_sort_idx').using('btree', table.sortOrder.asc().nullsLast().op('int4_ops')),
    check('faq_categories_name_check', sql`(btrim(name) <> ''::text) AND (char_length(name) <= 60)`),
  ],
);

export const companyProfile = pgTable(
  'company_profile',
  {
    id: boolean().default(true).primaryKey().notNull(),
    name: text().notNull(),
    street: text(),
    postalCode: text('postal_code'),
    city: text(),
    taxId: text('tax_id'),
    supportEmail: text('support_email').notNull(),
    supportPhone: text('support_phone').notNull(),
    supportHours: text('support_hours'),
    regon: text(),
    krs: text(),
    registryCourt: text('registry_court'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    shareCapitalGrosze: bigint('share_capital_grosze', { mode: 'number' }),
    version: integer().default(1).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'company_profile_updated_by_fkey',
    }),
    check('company_profile_address', sql`num_nulls(street, postal_code, city) = ANY (ARRAY[0, 3])`),
    check('company_profile_city_check', sql`btrim(city) <> ''::text`),
    check('company_profile_id_check', sql`CHECK (id)`),
    check('company_profile_krs_check', sql`krs ~ '^\d{10}$'::text`),
    check('company_profile_name_check', sql`(btrim(name) <> ''::text) AND (char_length(name) <= 200)`),
    check('company_profile_postal_code_check', sql`postal_code ~ '^\d{2}-\d{3}$'::text`),
    check('company_profile_registry_court_check', sql`btrim(registry_court) <> ''::text`),
    check('company_profile_regon_check', sql`regon ~ '^(\d{9}|\d{14})$'::text`),
    check('company_profile_share_capital_grosze_check', sql`share_capital_grosze > 0`),
    check('company_profile_street_check', sql`btrim(street) <> ''::text`),
    check(
      'company_profile_support_email_check',
      sql`(btrim(support_email) <> ''::text) AND (char_length(support_email) <= 200)`,
    ),
    check('company_profile_support_hours_check', sql`char_length(support_hours) <= 60`),
    check(
      'company_profile_support_phone_check',
      sql`(btrim(support_phone) <> ''::text) AND (char_length(support_phone) <= 40)`,
    ),
    check('company_profile_tax_id_check', sql`tax_id ~ '^\d{10}$'::text`),
  ],
);

export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    status: jobStatus().default('QUEUED').notNull(),
    fileId: uuid('file_id'),
    sizeBytes: integer('size_bytes'),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('data_exports_one_open')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status = ANY (ARRAY['QUEUED'::job_status, 'RUNNING'::job_status]))`),
    index('data_exports_open_idx')
      .using('btree', table.requestedAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = ANY (ARRAY['QUEUED'::job_status, 'RUNNING'::job_status]))`),
    index('data_exports_purge_idx')
      .using('btree', table.expiresAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`((status = 'SUCCEEDED'::job_status) AND (deleted_at IS NULL))`),
    index('data_exports_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.requestedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'data_exports_file_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'data_exports_user_id_fkey',
    }),
    unique('data_exports_file_id_key').on(table.fileId),
    check('data_exports_deleted_file', sql`(deleted_at IS NULL) OR (file_id IS NOT NULL)`),
    check('data_exports_error_code_check', sql`error_code ~ '^[A-Z_]+$'::text`),
    check('data_exports_expires_after', sql`(expires_at IS NULL) OR (expires_at > finished_at)`),
    check('data_exports_failed_code', sql`(status <> 'FAILED'::job_status) OR (error_code IS NOT NULL)`),
    check(
      'data_exports_finished',
      sql`(status = ANY (ARRAY['SUCCEEDED'::job_status, 'FAILED'::job_status])) = (finished_at IS NOT NULL)`,
    ),
    check('data_exports_size_bytes_check', sql`size_bytes > 0`),
    check(
      'data_exports_succeeded_file',
      sql`(status <> 'SUCCEEDED'::job_status) OR ((file_id IS NOT NULL) AND (expires_at IS NOT NULL))`,
    ),
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
    vatRate: numeric('vat_rate', { precision: 4, scale: 2 }),
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

export const vLowStockParts = pgView('v_low_stock_parts', {
  id: uuid(),
  sku: text(),
  name: text(),
  stockQty: integer('stock_qty'),
  minStockQty: integer('min_stock_qty'),
  shortage: integer(),
}).as(
  sql`SELECT id, sku, name, stock_qty, min_stock_qty, min_stock_qty - stock_qty AS shortage FROM spare_parts WHERE active AND stock_qty < min_stock_qty`,
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

export const vPublishedNews = pgView('v_published_news', {
  id: uuid(),
  slug: text(),
  title: text(),
  lead: text(),
  bodyMd: text('body_md'),
  mediaId: uuid('media_id'),
  publishFrom: timestamp('publish_from', { withTimezone: true, mode: 'date' }),
  publishTo: timestamp('publish_to', { withTimezone: true, mode: 'date' }),
  mediaKey: text('media_key'),
  mediaPath: text('media_path'),
  mediaAltText: text('media_alt_text'),
  mediaCaption: text('media_caption'),
  mediaWidth: integer('media_width'),
  mediaHeight: integer('media_height'),
  firstPublishedAt: timestamp('first_published_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.media_id, n.publish_from, n.publish_to, m.key AS media_key, m.path AS media_path, m.alt_text AS media_alt_text, m.caption AS media_caption, m.width AS media_width, m.height AS media_height, n.first_published_at, n.updated_at FROM news n LEFT JOIN v_public_media m ON m.id = n.media_id WHERE n.status = 'PUBLISHED'::content_status AND n.publish_from <= now() AND (n.publish_to IS NULL OR n.publish_to > now())`,
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
  sql`SELECT rc.id, rc.number, rc.kind, rc.issued_at, rc.user_id, rc.buyer_name, rc.buyer_phone, rc.rental_id, r.number AS rental_number, rc.payment_id, rc.refund_id, rc.payment_source, pm.brand AS card_brand, pm.last4 AS card_last4, rc.total_amount, rc.currency, COALESCE(v.vat_amount, 0::bigint) AS vat_amount, rc.total_amount - COALESCE(v.vat_amount, 0::bigint) AS net_amount, v.vat_rate, rc.corrects_receipt_id, o.number AS corrects_number, ( SELECT count(*)::integer AS count FROM receipts c WHERE c.corrects_receipt_id = rc.id) AS corrections FROM receipts rc LEFT JOIN rentals r ON r.id = rc.rental_id LEFT JOIN payments p ON p.id = rc.payment_id LEFT JOIN payment_methods pm ON rc.payment_source = 'CARD'::payment_source AND pm.id = COALESCE(p.payment_method_id, r.payment_method_id) LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id LEFT JOIN LATERAL ( SELECT CASE WHEN count(DISTINCT g.vat_rate) = 1 THEN max(g.vat_rate) ELSE NULL::numeric END AS vat_rate, sum(g.vat_amount)::bigint AS vat_amount FROM ( SELECT i.vat_rate, fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate) AS vat_amount FROM receipt_items i WHERE i.receipt_id = rc.id GROUP BY i.vat_rate) g) v ON true`,
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

export const vScooterStatusHistory = pgView('v_scooter_status_history', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  modelId: uuid('model_id'),
  status: scooterStatus(),
  online: boolean(),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
  validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  isOpen: boolean('is_open'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  durationSeconds: bigint('duration_seconds', { mode: 'number' }),
  category: text(),
  reason: text(),
  reasonRentalId: uuid('reason_rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  reasonRentalNumber: bigint('reason_rental_number', { mode: 'number' }),
  reasonTaskId: uuid('reason_task_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  reasonTaskNumber: bigint('reason_task_number', { mode: 'number' }),
  reasonTaskType: serviceTaskType('reason_task_type'),
  reasonTaskAssigneeId: uuid('reason_task_assignee_id'),
  reasonTaskAssigneeName: text('reason_task_assignee_name'),
  reasonTicketId: uuid('reason_ticket_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  reasonTicketNumber: bigint('reason_ticket_number', { mode: 'number' }),
  reasonTicketAutoKind: ticketAutoKind('reason_ticket_auto_kind'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  reasonAuditId: bigint('reason_audit_id', { mode: 'number' }),
  reasonAuditAction: text('reason_audit_action'),
  reasonStaffId: uuid('reason_staff_id'),
  reasonStaffName: text('reason_staff_name'),
}).as(
  sql`SELECT h.id, h.scooter_id, sc.number AS scooter_number, sc.model_id, h.status, h.online, h.valid_from, h.valid_to, h.valid_to IS NULL AS is_open, floor(EXTRACT(epoch FROM COALESCE(h.valid_to, now()) - h.valid_from))::bigint AS duration_seconds, fn_scooter_time_category(h.status, h.online) AS category, CASE WHEN rn.id IS NOT NULL THEN CASE WHEN h.status = 'RESERVED'::scooter_status THEN 'RESERVATION'::text ELSE 'RENTAL'::text END WHEN tk.id IS NOT NULL THEN 'SERVICE_TASK'::text WHEN tc.id IS NOT NULL THEN CASE WHEN tc.auto_kind = 'OFFLINE'::ticket_auto_kind THEN 'AUTO_OFFLINE'::text ELSE 'TICKET'::text END WHEN au.id IS NOT NULL THEN 'STAFF'::text WHEN NOT h.online THEN 'NO_TELEMETRY'::text ELSE 'SYSTEM'::text END AS reason, rn.id AS reason_rental_id, rn.number AS reason_rental_number, tk.id AS reason_task_id, tk.number AS reason_task_number, tk.type AS reason_task_type, tk.assignee_id AS reason_task_assignee_id, ta.name AS reason_task_assignee_name, tc.id AS reason_ticket_id, tc.number AS reason_ticket_number, tc.auto_kind AS reason_ticket_auto_kind, au.id AS reason_audit_id, au.action AS reason_audit_action, au.staff_id AS reason_staff_id, ast.name AS reason_staff_name FROM scooter_status_history h JOIN scooters sc ON sc.id = h.scooter_id LEFT JOIN LATERAL ( SELECT r.id, r.number FROM rentals r CROSS JOIN LATERAL ( SELECT COALESCE(r.reserved_at, r.created_at) AS began, COALESCE(r.ended_at, CASE WHEN r.state = ANY (ARRAY['EXPIRED'::rental_state, 'UNLOCK_FAILED'::rental_state]) THEN COALESCE(( SELECT min(e.created_at) AS min FROM rental_events e WHERE e.rental_id = r.id AND e.type = 'STATE_CHANGED'::rental_event_type AND e.to_state = r.state), r.updated_at) ELSE NULL::timestamp with time zone END, 'infinity'::timestamp with time zone) AS finished) p WHERE (h.status = ANY (ARRAY['IN_USE'::scooter_status, 'RESERVED'::scooter_status])) AND r.scooter_id = h.scooter_id AND p.began < COALESCE(h.valid_to, 'infinity'::timestamp with time zone) AND p.finished > h.valid_from ORDER BY p.began DESC LIMIT 1) rn ON true LEFT JOIN LATERAL ( SELECT t.id, t.number, t.type, t.assignee_id FROM service_tasks t WHERE h.status = 'MAINTENANCE'::scooter_status AND t.scooter_id = h.scooter_id AND t.created_at < COALESCE(h.valid_to, 'infinity'::timestamp with time zone) AND COALESCE(t.completed_at, 'infinity'::timestamp with time zone) > h.valid_from ORDER BY (t.status = 'CANCELLED'::service_task_status), t.created_at DESC LIMIT 1) tk ON true LEFT JOIN staff ta ON ta.id = tk.assignee_id LEFT JOIN LATERAL ( SELECT k.id, k.number, k.auto_kind FROM tickets k WHERE k.scooter_id = h.scooter_id AND (h.status = 'MAINTENANCE'::scooter_status OR NOT h.online AND k.auto_kind = 'OFFLINE'::ticket_auto_kind) AND k.created_at < COALESCE(h.valid_to, 'infinity'::timestamp with time zone) AND COALESCE(k.resolved_at, 'infinity'::timestamp with time zone) > h.valid_from ORDER BY ((NOT k.auto_kind IS DISTINCT FROM 'OFFLINE'::ticket_auto_kind) = (NOT h.online)) DESC, k.urgent DESC, k.created_at DESC LIMIT 1) tc ON true LEFT JOIN LATERAL ( SELECT a.id, a.action, a.staff_id FROM audit_log a WHERE a.entity_type = 'scooter'::text AND a.entity_id = h.scooter_id AND a.actor = 'STAFF'::audit_actor AND a.created_at >= (h.valid_from - '00:00:05'::interval) AND a.created_at <= (h.valid_from + '00:00:05'::interval) ORDER BY (abs(EXTRACT(epoch FROM a.created_at - h.valid_from))), a.id DESC LIMIT 1) au ON true LEFT JOIN staff ast ON ast.id = au.staff_id WHERE h.valid_to IS NULL OR h.valid_to > h.valid_from`,
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

export const vReportRunList = pgView('v_report_run_list', {
  id: uuid(),
  shortId: text('short_id'),
  reportCode: text('report_code'),
  reportName: text('report_name'),
  permissionCode: text('permission_code'),
  format: reportFormat(),
  params: jsonb(),
  status: jobStatus(),
  state: text(),
  requestedBy: uuid('requested_by'),
  requestedByName: text('requested_by_name'),
  requestedByRoles: text('requested_by_roles'),
  fileId: uuid('file_id'),
  fileSizeBytes: integer('file_size_bytes'),
  rowCount: integer('row_count'),
  pageCount: integer('page_count'),
  dataAsOf: timestamp('data_as_of', { withTimezone: true, mode: 'date' }),
  errorCode: text('error_code'),
  error: text(),
  retryOf: uuid('retry_of'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  durationMs: bigint('duration_ms', { mode: 'number' }),
  fileDeletedAt: timestamp('file_deleted_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT rr.id, "left"(rr.id::text, 8) AS short_id, rr.report_code, d.name AS report_name, d.permission_code, rr.format, rr.params, rr.status, CASE WHEN rr.file_deleted_at IS NOT NULL THEN 'FILE_DELETED'::text ELSE rr.status::text END AS state, rr.requested_by, s.name AS requested_by_name, ( SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[]) AS "coalesce" FROM staff_roles sr JOIN roles r ON r.id = sr.role_id WHERE sr.staff_id = rr.requested_by) AS requested_by_roles, rr.file_id, f.size_bytes AS file_size_bytes, rr.row_count, rr.page_count, rr.data_as_of, rr.error_code, rr.error, rr.retry_of, rr.created_at, rr.started_at, rr.finished_at, CASE WHEN rr.finished_at IS NOT NULL AND rr.started_at IS NOT NULL THEN floor(EXTRACT(epoch FROM rr.finished_at - rr.started_at) * 1000::numeric)::bigint ELSE NULL::bigint END AS duration_ms, rr.file_deleted_at FROM report_runs rr JOIN report_definitions d ON d.code = rr.report_code JOIN staff s ON s.id = rr.requested_by LEFT JOIN files f ON f.id = rr.file_id`,
);

export const vReportDefinitions = pgView('v_report_definitions', {
  code: text(),
  name: text(),
  description: text(),
  permissionCode: text('permission_code'),
  parameters: jsonb(),
  formats: reportFormat(),
  active: boolean(),
  sortOrder: integer('sort_order'),
  permissionRoles: text('permission_roles'),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  runs: integer(),
  lastRunId: uuid('last_run_id'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }),
  lastRunFormat: reportFormat('last_run_format'),
  lastRunState: text('last_run_state'),
}).as(
  sql`SELECT d.code, d.name, d.description, d.permission_code, d.parameters, d.formats, d.active, d.sort_order, ( SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[]) AS "coalesce" FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = d.permission_code) AS permission_roles, d.updated_by, s.name AS updated_by_name, d.updated_at, d.version, ( SELECT count(*)::integer AS count FROM report_runs rr WHERE rr.report_code = d.code) AS runs, lr.id AS last_run_id, lr.created_at AS last_run_at, lr.format AS last_run_format, CASE WHEN lr.file_deleted_at IS NOT NULL THEN 'FILE_DELETED'::text ELSE lr.status::text END AS last_run_state FROM report_definitions d LEFT JOIN staff s ON s.id = d.updated_by LEFT JOIN LATERAL ( SELECT rr.id, rr.created_at, rr.format, rr.status, rr.file_deleted_at FROM report_runs rr WHERE rr.report_code = d.code ORDER BY rr.created_at DESC LIMIT 1) lr ON true`,
);

export const vConsentList = pgView('v_consent_list', {
  id: uuid(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  userStatus: userStatus('user_status'),
  type: consentType(),
  documentVersion: text('document_version'),
  pageVersionId: uuid('page_version_id'),
  versionNo: integer('version_no'),
  documentSlug: text('document_slug'),
  documentTitle: text('document_title'),
  source: consentSource(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  revokedByStaff: uuid('revoked_by_staff'),
  revokedByName: text('revoked_by_name'),
  currentVersionId: uuid('current_version_id'),
  currentVersionNo: integer('current_version_no'),
  isLatest: boolean('is_latest'),
  state: text(),
  stateAt: timestamp('state_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT c.id, c.user_id, u.name AS user_name, u.phone AS user_phone, u.status AS user_status, c.type, c.document_version, c.page_version_id, v.version_no, p.slug AS document_slug, v.title AS document_title, c.source, c.accepted_at, c.revoked_at, c.revoked_by_staff, s.name AS revoked_by_name, cur.version_id AS current_version_id, cur.version_no AS current_version_no, latest.id = c.id AS is_latest, CASE WHEN c.revoked_at IS NOT NULL THEN 'REVOKED'::text WHEN latest.id <> c.id THEN 'SUPERSEDED'::text WHEN c.type = 'AGE'::consent_type THEN 'CONFIRMED'::text WHEN cur.version_id IS NULL OR c.page_version_id = cur.version_id THEN 'CURRENT'::text ELSE 'OUTDATED'::text END AS state, COALESCE(c.revoked_at, c.accepted_at) AS state_at FROM consents c JOIN users u ON u.id = c.user_id LEFT JOIN content_page_versions v ON v.id = c.page_version_id LEFT JOIN content_pages p ON p.id = v.page_id LEFT JOIN v_current_documents cur ON cur.consent_type = c.type LEFT JOIN staff s ON s.id = c.revoked_by_staff JOIN LATERAL ( SELECT l.id FROM consents l WHERE l.user_id = c.user_id AND l.type = c.type ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) latest ON true`,
);

export const vSessionList = pgView('v_session_list', {
  id: uuid(),
  shortId: text('short_id'),
  firstSessionId: uuid('first_session_id'),
  currentSessionId: uuid('current_session_id'),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  userStatus: userStatus('user_status'),
  deviceName: text('device_name'),
  platform: sessionPlatform(),
  appVersion: text('app_version'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  rotations: integer(),
  state: text(),
}).as(
  sql`SELECT f.family_id AS id, "left"(fs.id::text, 8) AS short_id, fs.id AS first_session_id, cur.id AS current_session_id, f.user_id, u.name AS user_name, u.phone AS user_phone, u.status AS user_status, cur.device_name, cur.platform, cur.app_version, f.created_at, f.last_used_at, cur.expires_at, cur.revoked_at, f.tokens - 1 AS rotations, CASE WHEN cur.revoked_at IS NOT NULL THEN 'REVOKED'::text WHEN cur.expires_at <= now() THEN 'EXPIRED'::text ELSE 'ACTIVE'::text END AS state FROM ( SELECT s.family_id, s.user_id, min(s.created_at) AS created_at, count(*)::integer AS tokens, max(COALESCE(s.last_used_at, s.created_at)) AS last_used_at FROM sessions s GROUP BY s.family_id, s.user_id) f JOIN LATERAL ( SELECT s.id, s.device_name, s.platform, s.app_version, s.expires_at, s.revoked_at FROM sessions s WHERE s.family_id = f.family_id ORDER BY (s.replaced_by IS NULL) DESC, s.created_at DESC, s.id DESC LIMIT 1) cur ON true JOIN LATERAL ( SELECT s.id FROM sessions s WHERE s.family_id = f.family_id ORDER BY s.created_at, s.id LIMIT 1) fs ON true JOIN users u ON u.id = f.user_id`,
);

export const vStaffSessionList = pgView('v_staff_session_list', {
  id: uuid(),
  shortId: text('short_id'),
  firstSessionId: uuid('first_session_id'),
  currentSessionId: uuid('current_session_id'),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  staffEmail: text('staff_email'),
  userAgent: text('user_agent'),
  remembered: boolean(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  rotations: integer(),
  state: text(),
}).as(
  sql`SELECT f.family_id AS id, "left"(fs.id::text, 8) AS short_id, fs.id AS first_session_id, cur.id AS current_session_id, f.staff_id, st.name AS staff_name, st.email AS staff_email, cur.user_agent, cur.remembered, f.created_at, f.last_used_at, cur.expires_at, cur.revoked_at, f.tokens - 1 AS rotations, CASE WHEN cur.revoked_at IS NOT NULL THEN 'REVOKED'::text WHEN cur.expires_at <= now() THEN 'EXPIRED'::text ELSE 'ACTIVE'::text END AS state FROM ( SELECT s.family_id, s.staff_id, min(s.created_at) AS created_at, count(*)::integer AS tokens, max(COALESCE(s.last_used_at, s.created_at)) AS last_used_at FROM staff_sessions s GROUP BY s.family_id, s.staff_id) f JOIN LATERAL ( SELECT s.id, s.user_agent, s.remembered, s.expires_at, s.revoked_at FROM staff_sessions s WHERE s.family_id = f.family_id ORDER BY (s.replaced_by IS NULL) DESC, s.created_at DESC, s.id DESC LIMIT 1) cur ON true JOIN LATERAL ( SELECT s.id FROM staff_sessions s WHERE s.family_id = f.family_id ORDER BY s.created_at, s.id LIMIT 1) fs ON true JOIN staff st ON st.id = f.staff_id`,
);

export const vStaffInvitationList = pgView('v_staff_invitation_list', {
  id: uuid(),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  staffEmail: text('staff_email'),
  staffActive: boolean('staff_active'),
  staffRoles: text('staff_roles'),
  invitedBy: uuid('invited_by'),
  invitedByName: text('invited_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  replacedBy: uuid('replaced_by'),
  isResend: boolean('is_resend'),
  state: text(),
}).as(
  sql`SELECT i.id, i.staff_id, st.name AS staff_name, st.email AS staff_email, st.active AS staff_active, ( SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[]) AS "coalesce" FROM staff_roles sr JOIN roles r ON r.id = sr.role_id WHERE sr.staff_id = i.staff_id) AS staff_roles, i.invited_by, inv.name AS invited_by_name, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.replaced_by, (EXISTS ( SELECT 1 FROM staff_invitations e WHERE e.staff_id = i.staff_id AND e.created_at < i.created_at)) AS is_resend, CASE WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'::text WHEN i.replaced_by IS NOT NULL THEN 'REPLACED'::text WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'::text WHEN i.expires_at <= now() THEN 'EXPIRED'::text ELSE 'PENDING'::text END AS state FROM staff_invitations i JOIN staff st ON st.id = i.staff_id LEFT JOIN staff inv ON inv.id = i.invited_by`,
);

export const vOtpCodeList = pgView('v_otp_code_list', {
  id: uuid(),
  phoneMasked: text('phone_masked'),
  phoneLast3: text('phone_last3'),
  userId: uuid('user_id'),
  userName: text('user_name'),
  purpose: otpPurpose(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  attempts: smallint(),
  consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  state: text(),
  purgeable: boolean(),
}).as(
  sql`SELECT o.id, CASE WHEN o.phone ~ '^\+48[0-9]{9}$'::text THEN '+48 ••• ••• '::text || "right"(o.phone, 3) ELSE '••• '::text || "right"(o.phone, 3) END AS phone_masked, "right"(o.phone, 3) AS phone_last3, u.id AS user_id, u.name AS user_name, o.purpose, o.created_at, o.expires_at, o.attempts, o.consumed_at, CASE WHEN o.consumed_at IS NOT NULL THEN 'CONSUMED'::text WHEN o.attempts >= 5 THEN 'BLOCKED'::text WHEN o.expires_at <= now() THEN 'EXPIRED'::text ELSE 'ACTIVE'::text END AS state, o.expires_at < (now() - '1 day'::interval) AS purgeable FROM otp_codes o LEFT JOIN users u ON u.phone = o.phone`,
);

export const vGeneratedDocuments = pgView('v_generated_documents', {
  id: uuid(),
  documentType: documentType('document_type'),
  entityRef: text('entity_ref'),
  entityLabel: text('entity_label'),
  params: jsonb(),
  format: documentFormat(),
  status: jobStatus(),
  state: text(),
  templateVersionId: uuid('template_version_id'),
  templateId: uuid('template_id'),
  templateName: text('template_name'),
  templateVersionNo: integer('template_version_no'),
  builtIn: boolean('built_in'),
  docxFileId: uuid('docx_file_id'),
  pdfFileId: uuid('pdf_file_id'),
  requesterKind: text('requester_kind'),
  requestedByStaff: uuid('requested_by_staff'),
  staffName: text('staff_name'),
  requestedByUser: uuid('requested_by_user'),
  userName: text('user_name'),
  errorCode: text('error_code'),
  error: text(),
  retryOf: uuid('retry_of'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  filesDeletedAt: timestamp('files_deleted_at', { withTimezone: true, mode: 'date' }),
  durationMs: integer('duration_ms'),
  customerDataVisible: boolean('customer_data_visible'),
}).as(
  sql`SELECT g.id, g.document_type, g.entity_ref, g.entity_label, g.params, g.format, g.status, CASE WHEN g.files_deleted_at IS NOT NULL THEN 'DELETED'::text ELSE g.status::text END AS state, g.template_version_id, v.template_id, t.name AS template_name, v.version_no AS template_version_no, g.template_version_id IS NULL AS built_in, g.docx_file_id, g.pdf_file_id, CASE WHEN g.requested_by_user IS NOT NULL THEN 'CUSTOMER'::text ELSE 'STAFF'::text END AS requester_kind, g.requested_by_staff, s.name AS staff_name, g.requested_by_user, u.name AS user_name, g.error_code, g.error, g.retry_of, g.created_at, g.started_at, g.finished_at, g.files_deleted_at, CASE WHEN g.finished_at IS NOT NULL AND g.started_at IS NOT NULL THEN floor(EXTRACT(epoch FROM g.finished_at - g.started_at) * 1000::numeric)::integer ELSE NULL::integer END AS duration_ms, g.customer_data_visible FROM generated_documents g LEFT JOIN document_template_versions v ON v.id = g.template_version_id LEFT JOIN document_templates t ON t.id = v.template_id LEFT JOIN staff s ON s.id = g.requested_by_staff LEFT JOIN users u ON u.id = g.requested_by_user`,
);

export const vPublicMedia = pgView('v_public_media', {
  id: uuid(),
  key: text(),
  name: text(),
  altText: text('alt_text'),
  caption: text(),
  isSystem: boolean('is_system'),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  width: integer(),
  height: integer(),
  sha256: text(),
  path: text(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT m.id, m.key, m.name, m.alt_text, m.caption, m.is_system, f.content_type, f.size_bytes, f.width, f.height, f.sha256, fn_media_path(m.id, f.sha256, f.content_type) AS path, m.updated_at FROM media_assets m JOIN files f ON f.id = m.file_id`,
);

export const vPublicContentBlocks = pgView('v_public_content_blocks', {
  client: contentClient(),
  key: text(),
  position: integer(),
  title: text(),
  bodyMd: text('body_md'),
  icon: text(),
  ctaLabel: text('cta_label'),
  ctaUrl: text('cta_url'),
  mediaId: uuid('media_id'),
  mediaKey: text('media_key'),
  mediaPath: text('media_path'),
  mediaAltText: text('media_alt_text'),
  mediaWidth: integer('media_width'),
  mediaHeight: integer('media_height'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT b.client, b.key, b."position", b.title, b.body_md, b.icon, b.cta_label, b.cta_url, b.media_id, m.key AS media_key, m.path AS media_path, m.alt_text AS media_alt_text, m.width AS media_width, m.height AS media_height, b.updated_at FROM content_blocks b LEFT JOIN v_public_media m ON m.id = b.media_id WHERE b.status = 'PUBLISHED'::content_status AND (b."position" = 0 OR (EXISTS ( SELECT 1 FROM content_blocks h WHERE h.key = b.key AND h."position" = 0 AND h.status = 'PUBLISHED'::content_status)))`,
);

export const vPublicFaq = pgView('v_public_faq', {
  categoryId: uuid('category_id'),
  categoryName: text('category_name'),
  categorySortOrder: integer('category_sort_order'),
  id: uuid(),
  question: text(),
  answerMd: text('answer_md'),
  sortOrder: integer('sort_order'),
  showOnWeb: boolean('show_on_web'),
  showInApp: boolean('show_in_app'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT c.id AS category_id, c.name AS category_name, c.sort_order AS category_sort_order, f.id, f.question, f.answer_md, f.sort_order, f.show_on_web, f.show_in_app, f.updated_at FROM faq_items f JOIN faq_categories c ON c.id = f.category_id WHERE f.status = 'PUBLISHED'::content_status`,
);

export const vCompanyPublic = pgView('v_company_public', {
  name: text(),
  street: text(),
  postalCode: text('postal_code'),
  city: text(),
  address: text(),
  taxId: text('tax_id'),
  supportEmail: text('support_email'),
  supportPhone: text('support_phone'),
  supportHours: text('support_hours'),
  regon: text(),
  krs: text(),
  registryCourt: text('registry_court'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  shareCapitalGrosze: bigint('share_capital_grosze', { mode: 'number' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT name, street, postal_code, city, CASE WHEN street IS NOT NULL THEN (((street || ', '::text) || postal_code) || ' '::text) || city ELSE NULL::text END AS address, tax_id, support_email, support_phone, support_hours, regon, krs, registry_court, share_capital_grosze, updated_at FROM company_profile c`,
);

export const vPublicDocumentVersions = pgView('v_public_document_versions', {
  pageId: uuid('page_id'),
  slug: text(),
  name: text(),
  consentType: consentType('consent_type'),
  versionId: uuid('version_id'),
  versionNo: integer('version_no'),
  title: text(),
  bodyMd: text('body_md'),
  changeSummary: text('change_summary'),
  status: contentStatus(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  isCurrent: boolean('is_current'),
}).as(
  sql`SELECT p.id AS page_id, p.slug, p.name, p.consent_type, v.id AS version_id, v.version_no, v.title, v.body_md, v.change_summary, v.status, v.published_at, ( SELECT min(n.published_at) AS min FROM content_page_versions n WHERE n.page_id = v.page_id AND n.version_no > v.version_no AND n.published_at IS NOT NULL) AS valid_to, v.status = 'PUBLISHED'::content_status AS is_current FROM content_pages p JOIN content_page_versions v ON v.page_id = p.id WHERE (v.status = ANY (ARRAY['PUBLISHED'::content_status, 'ARCHIVED'::content_status])) AND v.published_at IS NOT NULL`,
);

export const vPublicScooters = pgView('v_public_scooters', {
  number: integer(),
  modelCode: text('model_code'),
  modelName: text('model_name'),
  photoMediaId: uuid('photo_media_id'),
  photoPath: text('photo_path'),
  photoAltText: text('photo_alt_text'),
  photoWidth: integer('photo_width'),
  photoHeight: integer('photo_height'),
}).as(
  sql`SELECT s.number, m.code AS model_code, m.name AS model_name, m.photo_media_id, pm.path AS photo_path, pm.alt_text AS photo_alt_text, pm.width AS photo_width, pm.height AS photo_height FROM scooters s JOIN scooter_models m ON m.id = s.model_id LEFT JOIN v_public_media pm ON pm.id = m.photo_media_id WHERE s.status <> 'RETIRED'::scooter_status`,
);

export const vContentBlocks = pgView('v_content_blocks', {
  id: uuid(),
  key: text(),
  client: contentClient(),
  position: integer(),
  isHeader: boolean('is_header'),
  title: text(),
  bodyMd: text('body_md'),
  icon: text(),
  ctaLabel: text('cta_label'),
  ctaUrl: text('cta_url'),
  mediaId: uuid('media_id'),
  mediaKey: text('media_key'),
  mediaName: text('media_name'),
  mediaPath: text('media_path'),
  mediaAltText: text('media_alt_text'),
  mediaWidth: integer('media_width'),
  mediaHeight: integer('media_height'),
  status: contentStatus(),
  sectionItems: integer('section_items'),
  sectionItemsPublished: integer('section_items_published'),
  sectionDrafts: integer('section_drafts'),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT b.id, b.key, b.client, b."position", b."position" = 0 AS is_header, b.title, b.body_md, b.icon, b.cta_label, b.cta_url, b.media_id, m.key AS media_key, m.name AS media_name, m.path AS media_path, m.alt_text AS media_alt_text, m.width AS media_width, m.height AS media_height, b.status, ( SELECT count(*)::integer AS count FROM content_blocks e WHERE e.key = b.key AND e."position" > 0) AS section_items, ( SELECT count(*)::integer AS count FROM content_blocks e WHERE e.key = b.key AND e."position" > 0 AND e.status = 'PUBLISHED'::content_status) AS section_items_published, ( SELECT count(*)::integer AS count FROM content_blocks e WHERE e.key = b.key AND e.status = 'DRAFT'::content_status) AS section_drafts, b.updated_by, s.name AS updated_by_name, b.created_at, b.updated_at, b.version FROM content_blocks b LEFT JOIN v_public_media m ON m.id = b.media_id LEFT JOIN staff s ON s.id = b.updated_by`,
);

export const vFaqCategories = pgView('v_faq_categories', {
  id: uuid(),
  name: text(),
  sortOrder: integer('sort_order'),
  items: integer(),
  itemsPublished: integer('items_published'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT id, name, sort_order, ( SELECT count(*)::integer AS count FROM faq_items f WHERE f.category_id = c.id) AS items, ( SELECT count(*)::integer AS count FROM faq_items f WHERE f.category_id = c.id AND f.status = 'PUBLISHED'::content_status) AS items_published, created_at, updated_at, version FROM faq_categories c`,
);

export const vFaqList = pgView('v_faq_list', {
  id: uuid(),
  categoryId: uuid('category_id'),
  categoryName: text('category_name'),
  categorySortOrder: integer('category_sort_order'),
  question: text(),
  answerMd: text('answer_md'),
  sortOrder: integer('sort_order'),
  status: contentStatus(),
  showOnWeb: boolean('show_on_web'),
  showInApp: boolean('show_in_app'),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT f.id, f.category_id, c.name AS category_name, c.sort_order AS category_sort_order, f.question, f.answer_md, f.sort_order, f.status, f.show_on_web, f.show_in_app, f.updated_by, s.name AS updated_by_name, f.created_at, f.updated_at, f.version FROM faq_items f JOIN faq_categories c ON c.id = f.category_id LEFT JOIN staff s ON s.id = f.updated_by`,
);

export const vNewsList = pgView('v_news_list', {
  id: uuid(),
  slug: text(),
  title: text(),
  lead: text(),
  bodyMd: text('body_md'),
  status: contentStatus(),
  state: text(),
  publishFrom: timestamp('publish_from', { withTimezone: true, mode: 'date' }),
  publishTo: timestamp('publish_to', { withTimezone: true, mode: 'date' }),
  firstPublishedAt: timestamp('first_published_at', { withTimezone: true, mode: 'date' }),
  mediaId: uuid('media_id'),
  mediaKey: text('media_key'),
  mediaName: text('media_name'),
  mediaPath: text('media_path'),
  mediaAltText: text('media_alt_text'),
  createdBy: uuid('created_by'),
  createdByName: text('created_by_name'),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.status, fn_news_state(n.status, n.publish_from, n.publish_to, now()) AS state, n.publish_from, n.publish_to, n.first_published_at, n.media_id, m.key AS media_key, m.name AS media_name, m.path AS media_path, m.alt_text AS media_alt_text, n.created_by, c.name AS created_by_name, n.updated_by, s.name AS updated_by_name, n.created_at, n.updated_at, n.version FROM news n LEFT JOIN v_public_media m ON m.id = n.media_id LEFT JOIN staff c ON c.id = n.created_by LEFT JOIN staff s ON s.id = n.updated_by`,
);

export const vMediaUsages = pgView('v_media_usages', {
  mediaId: uuid('media_id'),
  kind: text(),
  entityId: uuid('entity_id'),
  ref: text(),
  position: integer(),
  client: text(),
  status: text(),
  label: text(),
}).as(
  sql`SELECT b.media_id, 'CONTENT_BLOCK'::text AS kind, b.id AS entity_id, b.key AS ref, b."position", b.client::text AS client, b.status::text AS status, b.title AS label FROM content_blocks b WHERE b.media_id IS NOT NULL UNION ALL SELECT n.media_id, 'NEWS'::text AS kind, n.id AS entity_id, n.slug AS ref, NULL::integer AS "position", 'WEB'::text AS client, n.status::text AS status, n.title AS label FROM news n WHERE n.media_id IS NOT NULL UNION ALL SELECT m.photo_media_id AS media_id, 'SCOOTER_MODEL'::text AS kind, m.id AS entity_id, m.code AS ref, NULL::integer AS "position", NULL::text AS client, CASE WHEN m.active THEN 'ACTIVE'::text ELSE 'INACTIVE'::text END AS status, m.name AS label FROM scooter_models m WHERE m.photo_media_id IS NOT NULL`,
);

export const vMediaList = pgView('v_media_list', {
  id: uuid(),
  key: text(),
  name: text(),
  altText: text('alt_text'),
  caption: text(),
  isSystem: boolean('is_system'),
  fileId: uuid('file_id'),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  width: integer(),
  height: integer(),
  sha256: text(),
  originalName: text('original_name'),
  path: text(),
  usages: integer(),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
}).as(
  sql`SELECT m.id, m.key, m.name, m.alt_text, m.caption, m.is_system, m.file_id, f.content_type, f.size_bytes, f.width, f.height, f.sha256, f.original_name, fn_media_path(m.id, f.sha256, f.content_type) AS path, ( SELECT count(*)::integer AS count FROM v_media_usages u WHERE u.media_id = m.id) AS usages, m.updated_by, s.name AS updated_by_name, m.created_at, m.updated_at, m.version FROM media_assets m JOIN files f ON f.id = m.file_id LEFT JOIN staff s ON s.id = m.updated_by`,
);

export const vDocumentTemplateVersions = pgView('v_document_template_versions', {
  id: uuid(),
  templateId: uuid('template_id'),
  documentType: documentType('document_type'),
  templateName: text('template_name'),
  templateIsDefault: boolean('template_is_default'),
  versionNo: integer('version_no'),
  state: text(),
  isActive: boolean('is_active'),
  fileId: uuid('file_id'),
  contentType: text('content_type'),
  sha256: text(),
  sizeBytes: integer('size_bytes'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  uncompressedBytes: bigint('uncompressed_bytes', { mode: 'number' }),
  fields: text(),
  warnings: jsonb(),
  note: text(),
  uploadedBy: uuid('uploaded_by'),
  uploadedByName: text('uploaded_by_name'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }),
  activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }),
  activatedBy: uuid('activated_by'),
  activatedByName: text('activated_by_name'),
  previewFileId: uuid('preview_file_id'),
  documents: integer(),
}).as(
  sql`SELECT v.id, v.template_id, t.document_type, t.name AS template_name, t.is_default AS template_is_default, v.version_no, CASE WHEN v.is_active THEN 'ACTIVE'::text WHEN v.activated_at IS NOT NULL THEN 'ARCHIVED'::text ELSE 'PENDING'::text END AS state, v.is_active, v.file_id, f.content_type, f.sha256, v.size_bytes, v.uncompressed_bytes, v.fields, v.warnings, v.note, v.uploaded_by, u.name AS uploaded_by_name, v.uploaded_at, v.activated_at, v.activated_by, a.name AS activated_by_name, v.preview_file_id, ( SELECT count(*)::integer AS count FROM generated_documents g WHERE g.template_version_id = v.id) AS documents FROM document_template_versions v JOIN document_templates t ON t.id = v.template_id JOIN files f ON f.id = v.file_id LEFT JOIN staff u ON u.id = v.uploaded_by LEFT JOIN staff a ON a.id = v.activated_by`,
);

export const vRentalEventList = pgView('v_rental_event_list', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: bigint({ mode: 'number' }),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  rentalState: rentalState('rental_state'),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  userId: uuid('user_id'),
  userName: text('user_name'),
  type: rentalEventType(),
  fromState: rentalState('from_state'),
  toState: rentalState('to_state'),
  zoneId: uuid('zone_id'),
  zoneCode: text('zone_code'),
  zoneName: text('zone_name'),
  zoneType: zoneType('zone_type'),
  data: jsonb(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT e.id, e.rental_id, r.number AS rental_number, r.state AS rental_state, r.scooter_id, s.number AS scooter_number, r.user_id, u.name AS user_name, e.type, e.from_state, e.to_state, e.zone_id, z.code AS zone_code, z.name AS zone_name, z.type AS zone_type, e.data, e.created_at FROM rental_events e JOIN rentals r ON r.id = e.rental_id JOIN scooters s ON s.id = r.scooter_id JOIN users u ON u.id = r.user_id LEFT JOIN zones z ON z.id = e.zone_id`,
);

export const vDataExports = pgView('v_data_exports', {
  id: uuid(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  status: jobStatus(),
  state: text(),
  fileId: uuid('file_id'),
  sizeBytes: integer('size_bytes'),
  requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  errorCode: text('error_code'),
}).as(
  sql`SELECT e.id, e.user_id, u.name AS user_name, u.phone AS user_phone, e.status, CASE WHEN e.deleted_at IS NOT NULL THEN 'DELETED'::text WHEN e.status = 'SUCCEEDED'::job_status AND e.expires_at <= now() THEN 'EXPIRED'::text ELSE e.status::text END AS state, e.file_id, e.size_bytes, e.requested_at, e.started_at, e.finished_at, e.expires_at, e.deleted_at, e.error_code FROM data_exports e JOIN users u ON u.id = e.user_id`,
);

export const vZonePresenceList = pgView('v_zone_presence_list', {
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  zoneId: uuid('zone_id'),
  zoneCode: text('zone_code'),
  zoneName: text('zone_name'),
  zoneType: zoneType('zone_type'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  enteredAt: timestamp('entered_at', { withTimezone: true, mode: 'date' }),
  outsideCount: smallint('outside_count'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  secondsInZone: bigint('seconds_in_zone', { mode: 'number' }),
}).as(
  sql`SELECT p.scooter_id, s.number AS scooter_number, p.zone_id, z.code AS zone_code, z.name AS zone_name, z.type AS zone_type, p.rental_id, r.number AS rental_number, p.entered_at, p.outside_count, floor(EXTRACT(epoch FROM now() - p.entered_at))::bigint AS seconds_in_zone FROM scooter_zone_presence p JOIN scooters s ON s.id = p.scooter_id JOIN zones z ON z.id = p.zone_id JOIN rentals r ON r.id = p.rental_id`,
);

export const vZoneControlList = pgView('v_zone_control_list', {
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  speedLimitKmh: smallint('speed_limit_kmh'),
  limitSynced: boolean('limit_synced'),
  limitCommandId: uuid('limit_command_id'),
  limitCommandStatus: commandStatus('limit_command_status'),
  stopped: boolean(),
  stopSynced: boolean('stop_synced'),
  stopCommandId: uuid('stop_command_id'),
  stopCommandStatus: commandStatus('stop_command_status'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT c.scooter_id, s.number AS scooter_number, c.rental_id, r.number AS rental_number, c.speed_limit_kmh, c.limit_synced, c.limit_command_id, lc.status AS limit_command_status, c.stopped, c.stop_synced, c.stop_command_id, sc.status AS stop_command_status, c.started_at, c.updated_at FROM scooter_zone_control c JOIN scooters s ON s.id = c.scooter_id JOIN rentals r ON r.id = c.rental_id LEFT JOIN scooter_commands lc ON lc.id = c.limit_command_id LEFT JOIN scooter_commands sc ON sc.id = c.stop_command_id`,
);

export const vDocReceipt = pgView('v_doc_receipt', {
  receiptId: uuid('receipt_id'),
  number: text(),
  kind: receiptKind(),
  isCorrection: boolean('is_correction'),
  issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
  userId: uuid('user_id'),
  buyerName: text('buyer_name'),
  buyerPhone: text('buyer_phone'),
  buyerEmail: text('buyer_email'),
  sellerName: text('seller_name'),
  sellerAddress: text('seller_address'),
  sellerTaxId: text('seller_tax_id'),
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
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  refundId: uuid('refund_id'),
  correctsReceiptId: uuid('corrects_receipt_id'),
  correctsNumber: text('corrects_number'),
  correctsIssuedAt: timestamp('corrects_issued_at', { withTimezone: true, mode: 'date' }),
  items: jsonb(),
  vatGroups: jsonb('vat_groups'),
  hasOutsideVat: boolean('has_outside_vat'),
  correctionReason: refundReason('correction_reason'),
  correctionNote: text('correction_note'),
}).as(
  sql`SELECT rc.id AS receipt_id, rc.number, rc.kind, rc.kind = 'CORRECTION'::receipt_kind AS is_correction, rc.issued_at, rc.user_id, rc.buyer_name, rc.buyer_phone, rc.buyer_email, rc.seller ->> 'name'::text AS seller_name, rc.seller ->> 'address'::text AS seller_address, rc.seller ->> 'taxId'::text AS seller_tax_id, rc.payment_source, l.card_brand, l.card_last4, rc.total_amount, rc.currency, l.vat_amount, l.net_amount, rc.rental_id, l.rental_number, rc.refund_id, rc.corrects_receipt_id, l.corrects_number, o.issued_at AS corrects_issued_at, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('lineNo', i.line_no, 'description', i.description, 'quantity', i.quantity, 'unitPrice', i.unit_price, 'vatRate', i.vat_rate, 'amount', i.amount) ORDER BY i.line_no), '[]'::jsonb) AS "coalesce" FROM receipt_items i WHERE i.receipt_id = rc.id) AS items, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('vatRate', g.vat_rate, 'gross', g.gross, 'vat', g.vat, 'net', g.gross - g.vat) ORDER BY g.vat_rate DESC NULLS LAST), '[]'::jsonb) AS "coalesce" FROM ( SELECT i.vat_rate, sum(i.amount)::bigint AS gross, COALESCE(fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate), 0::bigint) AS vat FROM receipt_items i WHERE i.receipt_id = rc.id GROUP BY i.vat_rate) g) AS vat_groups, (EXISTS ( SELECT 1 FROM receipt_items i WHERE i.receipt_id = rc.id AND i.vat_rate IS NULL)) AS has_outside_vat, f.reason AS correction_reason, f.note AS correction_note FROM receipts rc JOIN v_receipt_list l ON l.id = rc.id LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id LEFT JOIN refunds f ON f.id = rc.refund_id`,
);

export const vDocumentTemplates = pgView('v_document_templates', {
  id: uuid(),
  documentType: documentType('document_type'),
  name: text(),
  description: text(),
  isDefault: boolean('is_default'),
  active: boolean(),
  activeVersionId: uuid('active_version_id'),
  activeVersionNo: integer('active_version_no'),
  activeSince: timestamp('active_since', { withTimezone: true, mode: 'date' }),
  versions: integer(),
  pendingVersions: integer('pending_versions'),
  lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true, mode: 'date' }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: integer(),
  activeFields: integer('active_fields'),
  generated30D: integer('generated_30d'),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT t.id, t.document_type, t.name, t.description, t.is_default, t.active, av.id AS active_version_id, av.version_no AS active_version_no, av.activated_at AS active_since, ( SELECT count(*)::integer AS count FROM document_template_versions v WHERE v.template_id = t.id) AS versions, ( SELECT count(*)::integer AS count FROM document_template_versions v WHERE v.template_id = t.id AND v.activated_at IS NULL) AS pending_versions, ( SELECT max(g.created_at) AS max FROM generated_documents g JOIN document_template_versions v ON v.id = g.template_version_id WHERE v.template_id = t.id) AS last_generated_at, t.created_by, t.updated_by, s.name AS updated_by_name, t.created_at, t.updated_at, t.version, COALESCE(cardinality(av.fields), 0) AS active_fields, ( SELECT count(*)::integer AS count FROM generated_documents g JOIN document_template_versions v ON v.id = g.template_version_id WHERE v.template_id = t.id AND g.created_at >= (now() - '30 days'::interval)) AS generated_30d, t.deactivated_at FROM document_templates t LEFT JOIN document_template_versions av ON av.template_id = t.id AND av.is_active LEFT JOIN staff s ON s.id = t.updated_by`,
);

export const vScooterCommandList = pgView('v_scooter_command_list', {
  id: uuid(),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  type: commandType(),
  payload: jsonb(),
  source: commandSource(),
  zoneId: uuid('zone_id'),
  zoneCode: text('zone_code'),
  zoneName: text('zone_name'),
  issuedByStaff: uuid('issued_by_staff'),
  staffName: text('staff_name'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  status: commandStatus(),
  ackReason: text('ack_reason'),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  ackedAt: timestamp('acked_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  responseMs: bigint('response_ms', { mode: 'number' }),
}).as(
  sql`SELECT c.id, c.scooter_id, s.number AS scooter_number, c.type, c.payload, c.source, c.zone_id, z.code AS zone_code, z.name AS zone_name, c.issued_by_staff, st.name AS staff_name, c.rental_id, r.number AS rental_number, c.status, c.ack_reason, c.sent_at, c.acked_at, c.expires_at, CASE WHEN c.acked_at IS NOT NULL THEN floor(EXTRACT(epoch FROM c.acked_at - c.sent_at) * 1000::numeric)::bigint ELSE NULL::bigint END AS response_ms FROM scooter_commands c JOIN scooters s ON s.id = c.scooter_id LEFT JOIN zones z ON z.id = c.zone_id LEFT JOIN staff st ON st.id = c.issued_by_staff LEFT JOIN rentals r ON r.id = c.rental_id`,
);

export const vPaymentCustomerList = pgView('v_payment_customer_list', {
  userId: uuid('user_id'),
  userName: text('user_name'),
  userStatus: userStatus('user_status'),
  provider: text(),
  providerCustomerId: text('provider_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  paymentMethods: integer('payment_methods'),
  lastPaymentAt: timestamp('last_payment_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT pc.user_id, u.name AS user_name, u.status AS user_status, pc.provider, pc.provider_customer_id, pc.created_at, ( SELECT count(*)::integer AS count FROM payment_methods m WHERE m.user_id = pc.user_id AND m.provider = pc.provider AND m.removed_at IS NULL) AS payment_methods, ( SELECT max(p.created_at) AS max FROM payments p WHERE p.user_id = pc.user_id AND p.provider = pc.provider) AS last_payment_at FROM payment_customers pc JOIN users u ON u.id = pc.user_id`,
);

export const vPermissionList = pgView('v_permission_list', {
  code: text(),
  module: text(),
  description: text(),
  rolesCount: integer('roles_count'),
  roleNames: text('role_names'),
  inAdministrator: boolean('in_administrator'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  updatedBy: uuid('updated_by'),
  updatedByName: text('updated_by_name'),
  version: integer(),
}).as(
  sql`SELECT p.code, p.module, p.description, count(r.id)::integer AS roles_count, COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'::text[]) AS role_names, COALESCE(bool_or(r.name = 'Administrator'::text AND r.is_system), false) AS in_administrator, p.updated_at, p.updated_by, s.name AS updated_by_name, p.version FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_code = p.code LEFT JOIN roles r ON r.id = rp.role_id LEFT JOIN staff s ON s.id = p.updated_by GROUP BY p.code, s.name`,
);

export const vDocRental = pgView('v_doc_rental', {
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  number: bigint({ mode: 'number' }),
  state: rentalState(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  scooterId: uuid('scooter_id'),
  scooterNumber: integer('scooter_number'),
  scooterVariant: scooterVariant('scooter_variant'),
  modelName: text('model_name'),
  tariffId: uuid('tariff_id'),
  tariffVersion: integer('tariff_version'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  unlockFee: bigint('unlock_fee', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  minuteRate: bigint('minute_rate', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  pauseMinuteRate: bigint('pause_minute_rate', { mode: 'number' }),
  vatRate: numeric('vat_rate', { precision: 4, scale: 2 }),
  reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  rideSeconds: integer('ride_seconds'),
  pauseSeconds: integer('pause_seconds'),
  distanceM: integer('distance_m'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  totalAmount: bigint('total_amount', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  towingFee: bigint('towing_fee', { mode: 'number' }),
  endMode: rentalEndMode('end_mode'),
  paymentSource: paymentSource('payment_source'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  settlement: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  paidAmount: bigint('paid_amount', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundedAmount: bigint('refunded_amount', { mode: 'number' }),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
  startLat: doublePrecision('start_lat'),
  startLon: doublePrecision('start_lon'),
  endLat: doublePrecision('end_lat'),
  endLon: doublePrecision('end_lon'),
  startZoneCode: text('start_zone_code'),
  startZoneName: text('start_zone_name'),
  endZoneCode: text('end_zone_code'),
  endZoneName: text('end_zone_name'),
  timeline: jsonb(),
}).as(
  sql`SELECT d.id AS rental_id, d.number, d.state, d.user_id, d.user_name, d.user_phone, d.scooter_id, d.scooter_number, s.variant AS scooter_variant, m.name AS model_name, d.tariff_id, d.tariff_version, t.unlock_fee, t.minute_rate, t.pause_minute_rate, t.vat_rate, d.reserved_at, d.started_at, d.ended_at, d.ride_seconds, d.pause_seconds, d.distance_m, d.total_amount, d.towing_fee, d.end_mode, d.payment_source, d.card_brand, d.card_last4, d.settlement, d.paid_amount, d.refunded_amount, d.receipt_id, d.receipt_number, st_y(r.start_position) AS start_lat, st_x(r.start_position) AS start_lon, st_y(r.end_position) AS end_lat, st_x(r.end_position) AS end_lon, sz.code AS start_zone_code, sz.name AS start_zone_name, d.end_zone_code, d.end_zone_name, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('at', tl.at, 'kind', tl.kind, 'type', tl.type, 'fromState', tl.from_state, 'toState', tl.to_state, 'zoneCode', tl.zone_code, 'commandStatus', tl.command_status) ORDER BY tl.at, tl.event_id), '[]'::jsonb) AS "coalesce" FROM v_rental_timeline tl WHERE tl.rental_id = d.id) AS timeline FROM v_rental_details d JOIN rentals r ON r.id = d.id JOIN scooters s ON s.id = d.scooter_id JOIN scooter_models m ON m.id = s.model_id JOIN tariffs t ON t.id = d.tariff_id LEFT JOIN LATERAL ( SELECT z.code, z.name FROM zones z WHERE z.type = 'PARKING'::zone_type AND r.start_position IS NOT NULL AND st_contains(z.geom, r.start_position) ORDER BY z.active DESC, z.code LIMIT 1) sz ON true`,
);

export const vDocServiceTask = pgView('v_doc_service_task', {
  taskId: uuid('task_id'),
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
  serialNumber: text('serial_number'),
  scooterVariant: scooterVariant('scooter_variant'),
  modelName: text('model_name'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  odometerM: bigint('odometer_m', { mode: 'number' }),
  scooterStatus: scooterStatus('scooter_status'),
  scooterStatusReason: scooterStatusReason('scooter_status_reason'),
  scooterReturnBlockers: text('scooter_return_blockers'),
  assigneeId: uuid('assignee_id'),
  assigneeName: text('assignee_name'),
  createdByName: text('created_by_name'),
  cancelledByName: text('cancelled_by_name'),
  ticketId: uuid('ticket_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  ticketNumber: bigint('ticket_number', { mode: 'number' }),
  ticketCategories: ticketCategory('ticket_categories'),
  ticketDescription: text('ticket_description'),
  targetZoneCode: text('target_zone_code'),
  targetZoneName: text('target_zone_name'),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  partsCount: integer('parts_count'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  partsCost: bigint('parts_cost', { mode: 'number' }),
  parts: jsonb(),
  timeline: jsonb(),
}).as(
  sql`SELECT l.id AS task_id, l.number, l.type, l.status, l.priority, l.description, l.result_note, l.cancel_reason, l.scooter_id, l.scooter_number, s.serial_number, s.variant AS scooter_variant, m.name AS model_name, s.odometer_m, s.status AS scooter_status, s.status_reason AS scooter_status_reason, fn_scooter_return_blockers(s.id) AS scooter_return_blockers, l.assignee_id, l.assignee_name, l.created_by_name, l.cancelled_by_name, l.ticket_id, l.ticket_number, l.ticket_categories, tk.description AS ticket_description, l.target_zone_code, l.target_zone_name, l.due_at, l.created_at, l.started_at, l.completed_at, l.parts_count, l.parts_cost, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'quantity', p.quantity, 'unitCost', p.unit_cost, 'amount', p.amount) ORDER BY p.sku), '[]'::jsonb) AS "coalesce" FROM v_service_task_parts p WHERE p.task_id = l.id) AS parts, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'actor', a.actor, 'staffName', sf.name, 'data', a.data) ORDER BY a.created_at, a.id), '[]'::jsonb) AS "coalesce" FROM audit_log a LEFT JOIN staff sf ON sf.id = a.staff_id WHERE a.entity_type = 'service_task'::text AND a.entity_id = l.id) AS timeline FROM v_service_task_list l JOIN scooters s ON s.id = l.scooter_id JOIN scooter_models m ON m.id = s.model_id LEFT JOIN tickets tk ON tk.id = l.ticket_id`,
);

export const vDocScooter = pgView('v_doc_scooter', {
  scooterId: uuid('scooter_id'),
  number: integer(),
  serialNumber: text('serial_number'),
  variant: scooterVariant(),
  status: scooterStatus(),
  statusReason: scooterStatusReason('status_reason'),
  firmware: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  odometerM: bigint('odometer_m', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  modelCode: text('model_code'),
  modelName: text('model_name'),
  manufacturer: text(),
  maxSpeedKmh: smallint('max_speed_kmh'),
  rangeKm: smallint('range_km'),
  batteryWh: integer('battery_wh'),
  weightKg: numeric('weight_kg', { precision: 4, scale: 1 }),
  rentalsTotal: integer('rentals_total'),
  serviceTasks: jsonb('service_tasks'),
  tickets: jsonb(),
  rentals: jsonb(),
}).as(
  sql`SELECT s.id AS scooter_id, s.number, s.serial_number, s.variant, s.status, s.status_reason, s.firmware, s.odometer_m, s.created_at, m.code AS model_code, m.name AS model_name, m.manufacturer, m.max_speed_kmh, m.range_km, m.battery_wh, m.weight_kg, ( SELECT count(*)::integer AS count FROM rentals r WHERE r.scooter_id = s.id AND (r.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state]))) AS rentals_total, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', st.id, 'number', st.number, 'type', st.type, 'status', st.status, 'priority', st.priority, 'createdAt', st.created_at, 'completedAt', st.completed_at, 'resultNote', st.result_note, 'assigneeName', st.assignee_name, 'partsCost', st.parts_cost) ORDER BY st.created_at DESC), '[]'::jsonb) AS "coalesce" FROM v_service_task_list st WHERE st.scooter_id = s.id) AS service_tasks, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'status', t.status, 'categories', t.categories, 'source', t.source, 'urgent', t.urgent, 'createdAt', t.created_at, 'resolvedAt', t.resolved_at) ORDER BY t.created_at DESC), '[]'::jsonb) AS "coalesce" FROM tickets t WHERE t.scooter_id = s.id) AS tickets, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('endedAt', r.ended_at, 'distanceM', r.distance_m, 'rideSeconds', r.ride_seconds) ORDER BY r.ended_at DESC), '[]'::jsonb) AS "coalesce" FROM rentals r WHERE r.scooter_id = s.id AND (r.state = ANY (ARRAY['ENDED'::rental_state, 'UNPAID'::rental_state]))) AS rentals FROM scooters s JOIN scooter_models m ON m.id = s.model_id`,
);

export const vDocTicket = pgView('v_doc_ticket', {
  ticketId: uuid('ticket_id'),
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
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  reportedBy: uuid('reported_by'),
  reporterName: text('reporter_name'),
  reporterPhone: text('reporter_phone'),
  assigneeName: text('assignee_name'),
  customerReply: text('customer_reply'),
  customerReplyAt: timestamp('customer_reply_at', { withTimezone: true, mode: 'date' }),
  resolutionNote: text('resolution_note'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  refundedAmount: bigint('refunded_amount', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  photos: integer(),
  photoList: jsonb('photo_list'),
  timeline: jsonb(),
}).as(
  sql`SELECT id AS ticket_id, number, status, urgent, categories, source, auto_kind, description, scooter_id, scooter_number, rental_id, rental_number, reported_by, reporter_name, reporter_phone, assignee_name, customer_reply, customer_reply_at, resolution_note, refunded_amount, created_at, resolved_at, photos, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('position', p."position", 'uploadedAt', f.created_at, 'status', f.status, 'deletedAt', f.deleted_at) ORDER BY p."position"), '[]'::jsonb) AS "coalesce" FROM ticket_photos p JOIN files f ON f.id = p.file_id WHERE p.ticket_id = l.id) AS photo_list, ( SELECT COALESCE(jsonb_agg(jsonb_build_object('at', tl.at, 'kind', tl.kind, 'action', tl.action, 'actor', tl.actor, 'staffName', tl.staff_name, 'data', tl.data) ORDER BY tl.at, tl.kind_order, tl.seq), '[]'::jsonb) AS "coalesce" FROM v_ticket_timeline tl WHERE tl.ticket_id = l.id) AS timeline FROM v_ticket_list l`,
);

export const vDocWalletAdjustment = pgView('v_doc_wallet_adjustment', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  entryId: bigint('entry_id', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  userId: uuid('user_id'),
  userName: text('user_name'),
  userPhone: text('user_phone'),
  type: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  amount: bigint({ mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  balanceBefore: bigint('balance_before', { mode: 'number' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  balanceAfter: bigint('balance_after', { mode: 'number' }),
  reason: ledgerReason(),
  note: text(),
  staffId: uuid('staff_id'),
  staffName: text('staff_name'),
  rentalId: uuid('rental_id'),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  rentalNumber: bigint('rental_number', { mode: 'number' }),
  refundId: uuid('refund_id'),
  refundReason: refundReason('refund_reason'),
  receiptId: uuid('receipt_id'),
  receiptNumber: text('receipt_number'),
}).as(
  sql`SELECT id AS entry_id, created_at, user_id, user_name, user_phone, type, amount, balance_after - amount AS balance_before, balance_after, reason, note, staff_id, staff_name, rental_id, rental_number, refund_id, refund_reason, receipt_id, receipt_number FROM v_wallet_ledger l WHERE type = ANY (ARRAY['ADJUSTMENT'::text, 'REFUND'::text])`,
);

export const vSavedPlaceList = pgView('v_saved_place_list', {
  id: uuid(),
  userId: uuid('user_id'),
  userName: text('user_name'),
  label: placeLabel(),
  name: text(),
  lon: doublePrecision(),
  lat: doublePrecision(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
}).as(
  sql`SELECT sp.id, sp.user_id, u.name AS user_name, sp.label, sp.name, st_x(sp."position") AS lon, st_y(sp."position") AS lat, sp.created_at FROM saved_places sp JOIN users u ON u.id = sp.user_id`,
);
