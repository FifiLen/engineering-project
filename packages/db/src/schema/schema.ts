// Plik generowany przez `pnpm db:pull` na podstawie bazy. Nie edytuj ręcznie.
import {
  pgTable,
  unique,
  check,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  smallint,
  geometry,
  boolean,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  char,
  primaryKey,
  pgSequence,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const commandStatus = pgEnum('command_status', ['SENT', 'ACKED', 'REJECTED', 'TIMEOUT']);
export const commandType = pgEnum('command_type', [
  'UNLOCK',
  'LOCK',
  'SPEED_LIMIT',
  'STOP_GRADUALLY',
  'RING',
  'LIGHTS',
]);
export const consentType = pgEnum('consent_type', ['TERMS', 'PRIVACY', 'MARKETING', 'AGE']);
export const filePurpose = pgEnum('file_purpose', ['PARKING_PHOTO', 'TICKET_PHOTO']);
export const ledgerEntryType = pgEnum('ledger_entry_type', ['TOPUP', 'RIDE_CHARGE', 'REFUND', 'ADJUSTMENT']);
export const paymentMethodKind = pgEnum('payment_method_kind', ['CARD', 'BLIK']);
export const paymentPurpose = pgEnum('payment_purpose', ['TOPUP', 'RIDE']);
export const paymentSource = pgEnum('payment_source', ['WALLET', 'CARD']);
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export const placeLabel = pgEnum('place_label', ['HOME', 'WORK', 'CUSTOM']);
export const platform = pgEnum('platform', ['IOS', 'ANDROID']);
export const rentalEventType = pgEnum('rental_event_type', [
  'STATE_CHANGED',
  'ZONE_ENTERED',
  'ZONE_EXITED',
  'BATTERY_LOW',
  'CONNECTION_LOST',
  'CONNECTION_RESTORED',
  'PHOTO_UPLOADED',
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
export const scooterStatus = pgEnum('scooter_status', ['AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED']);
export const scooterVariant = pgEnum('scooter_variant', ['GRAFIT', 'BETON', 'KOBALT']);
export const staffRole = pgEnum('staff_role', ['ADMIN', 'DISPATCHER', 'SERVICE']);
export const ticketCategory = pgEnum('ticket_category', [
  'BRAKES',
  'LIGHTS',
  'WHEEL',
  'HANDLEBAR',
  'QR_CODE',
  'BATTERY',
  'CONNECTION',
  'OTHER',
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
  },
  (table) => [
    unique('users_phone_key').on(table.phone),
    unique('users_email_key').on(table.email),
    check('users_check', sql`(status <> 'DELETED'::user_status) OR ((phone IS NULL) AND (email IS NULL))`),
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
  },
  (table) => [
    index('consents_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.type.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'consents_user_id_fkey',
    }),
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
  },
  (table) => [
    index('otp_codes_phone_idx').using(
      'btree',
      table.phone.asc().nullsLast().op('text_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
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
  },
  (table) => [
    index('sessions_user_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }),
    unique('sessions_refresh_token_hash_key').on(table.refreshTokenHash),
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
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'push_tokens_user_id_fkey',
    }),
    unique('push_tokens_expo_token_key').on(table.expoToken),
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

export const staff = pgTable(
  'staff',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text().notNull(),
    name: text().notNull(),
    role: staffRole().notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretEnc: text('totp_secret_enc'),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [unique('staff_email_key').on(table.email)],
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
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [staff.id],
      name: 'tariffs_created_by_fkey',
    }),
    unique('tariffs_version_key').on(table.version),
    check('tariffs_unlock_fee_check', sql`unlock_fee >= 0`),
    check('tariffs_minute_rate_check', sql`minute_rate >= 0`),
    check('tariffs_pause_minute_rate_check', sql`pause_minute_rate >= 0`),
    check('tariffs_out_of_zone_fee_check', sql`out_of_zone_fee >= 0`),
    check('tariffs_min_battery_pct_check', sql`(min_battery_pct >= 0) AND (min_battery_pct <= 100)`),
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
  },
  (table) => [
    index('scooters_position_gix').using('gist', table.position.asc().nullsLast().op('gist_geometry_ops_2d')),
    index('scooters_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    unique('scooters_number_key').on(table.number),
    unique('scooters_serial_number_key').on(table.serialNumber),
    check('scooters_battery_pct_check', sql`(battery_pct >= 0) AND (battery_pct <= 100)`),
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
  },
  (table) => [
    index('scooter_commands_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('timestamptz_ops'),
      table.sentAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'scooter_commands_scooter_id_fkey',
    }),
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
  },
  (table) => [
    index('zones_geom_gix')
      .using('gist', table.geom.asc().nullsLast().op('gist_geometry_ops_2d'))
      .where(sql`active`),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [staff.id],
      name: 'zones_updated_by_fkey',
    }),
    unique('zones_code_key').on(table.code),
    check('zones_geom_check', sql`CHECK (st_isvalid(geom`),
    check('zones_check', sql`(type <> 'SLOW'::zone_type) OR (speed_limit_kmh IS NOT NULL)`),
    check('zones_check1', sql`(type = 'PARKING'::zone_type) OR (capacity IS NULL)`),
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
  },
  (table) => [
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
    index('rentals_scooter_idx').using(
      'btree',
      table.scooterId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    index('rentals_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'rentals_user_id_fkey',
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
      columns: [table.endZoneId],
      foreignColumns: [zones.id],
      name: 'rentals_end_zone_id_fkey',
    }),
    foreignKey({
      columns: [table.parkingPhotoId],
      foreignColumns: [files.id],
      name: 'rentals_photo_fk',
    }),
    unique('rentals_number_key').on(table.number),
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
  },
  (table) => [
    index('payments_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'payments_user_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'payments_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.paymentMethodId],
      foreignColumns: [paymentMethods.id],
      name: 'payments_payment_method_id_fkey',
    }),
    unique('payments_provider_payment_id_key').on(table.providerPaymentId),
    unique('payments_idempotency_key_key').on(table.idempotencyKey),
    check('payments_amount_check', sql`amount > 0`),
    check('payments_check', sql`(purpose <> 'RIDE'::payment_purpose) OR (rental_id IS NOT NULL)`),
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
  },
  (table) => [
    uniqueIndex('wallet_ledger_one_charge_per_rental')
      .using('btree', table.rentalId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(type = 'RIDE_CHARGE'::ledger_entry_type)`),
    index('wallet_ledger_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int8_ops'),
      table.id.desc().nullsFirst().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [wallets.userId],
      name: 'wallet_ledger_user_id_fkey',
    }),
    foreignKey({
      columns: [table.rentalId],
      foreignColumns: [rentals.id],
      name: 'wallet_ledger_rental_id_fkey',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'wallet_ledger_payment_id_fkey',
    }),
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'wallet_ledger_staff_id_fkey',
    }),
    check('wallet_ledger_amount_check', sql`amount <> 0`),
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
  },
  (table) => [unique('payment_webhook_events_provider_event_id_key').on(table.providerEventId)],
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
  },
  (table) => [
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [users.id],
      name: 'files_uploaded_by_fkey',
    }),
    unique('files_storage_key_key').on(table.storageKey),
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
  },
  (table) => [
    index('tickets_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.scooterId],
      foreignColumns: [scooters.id],
      name: 'tickets_scooter_id_fkey',
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
      columns: [table.assigneeId],
      foreignColumns: [staff.id],
      name: 'tickets_assignee_id_fkey',
    }),
    check('tickets_categories_check', sql`cardinality(categories) > 0`),
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
    type: text().notNull(),
    payload: jsonb().default({}).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'notifications_user_id_fkey',
    }),
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
    staffId: uuid('staff_id').notNull(),
    action: text().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.staffId],
      foreignColumns: [staff.id],
      name: 'audit_log_staff_id_fkey',
    }),
  ],
);

export const ticketPhotos = pgTable(
  'ticket_photos',
  {
    ticketId: uuid('ticket_id').notNull(),
    fileId: uuid('file_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [tickets.id],
      name: 'ticket_photos_ticket_id_fkey',
    }),
    foreignKey({
      columns: [table.fileId],
      foreignColumns: [files.id],
      name: 'ticket_photos_file_id_fkey',
    }),
    primaryKey({ columns: [table.ticketId, table.fileId], name: 'ticket_photos_pkey' }),
  ],
);
