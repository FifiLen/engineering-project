import type { NotificationPreferences } from '@hulajnogi/core';
import {
  notificationsResource,
  notificationTemplatesResource,
  pushTokensResource,
  type ListQuery,
  type ListResponse,
  type NotificationChannel,
  type NotificationListItem,
  type NotificationStatus,
  type NotificationTemplateListItem,
  type NotificationTemplateVersionView,
  type PushPlatform,
  type PushTokenListItem,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { vNotificationList, vNotificationTemplates, vPushTokens } from '../schema/schema.js';

type Row = Record<string, unknown>;
type TemplateField = keyof typeof notificationTemplatesResource.fields & string;
type NotificationField = keyof typeof notificationsResource.fields & string;
type PushTokenField = keyof typeof pushTokensResource.fields & string;

const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

const templateSource: ListSource<TemplateField> = {
  from: vNotificationTemplates,
  id: vNotificationTemplates.id,
  columns: {
    id: vNotificationTemplates.id,
    code: vNotificationTemplates.code,
    channel: vNotificationTemplates.channel,
    title: vNotificationTemplates.title,
    body: vNotificationTemplates.body,
    description: vNotificationTemplates.description,
    version: vNotificationTemplates.version,
    updatedAt: vNotificationTemplates.updatedAt,
    updatedByName: vNotificationTemplates.updatedByName,
    versions: vNotificationTemplates.versions,
    lastSentAt: vNotificationTemplates.lastSentAt,
    sent30d: vNotificationTemplates.sent30D,
  },
};

const notificationSource: ListSource<NotificationField> = {
  from: vNotificationList,
  id: vNotificationList.id,
  columns: {
    id: vNotificationList.id,
    createdAt: vNotificationList.createdAt,
    sentAt: vNotificationList.sentAt,
    status: vNotificationList.status,
    channel: vNotificationList.channel,
    templateCode: vNotificationList.templateCode,
    templateVersion: vNotificationList.templateVersion,
    title: vNotificationList.title,
    body: vNotificationList.body,
    error: vNotificationList.error,
    dedupeKey: vNotificationList.dedupeKey,
    providerRef: vNotificationList.providerRef,
    readAt: vNotificationList.readAt,
    userId: vNotificationList.userId,
    userName: vNotificationList.userName,
    userPhone: vNotificationList.userPhone,
    rentalId: vNotificationList.rentalId,
    rentalNumber: vNotificationList.rentalNumber,
    ticketId: vNotificationList.ticketId,
    ticketNumber: vNotificationList.ticketNumber,
  },
};

const pushTokenSource: ListSource<PushTokenField> = {
  from: vPushTokens,
  id: vPushTokens.id,
  columns: {
    id: vPushTokens.id,
    userId: vPushTokens.userId,
    userName: vPushTokens.userName,
    userPhone: vPushTokens.userPhone,
    platform: vPushTokens.platform,
    expoToken: vPushTokens.expoToken,
    sessionId: vPushTokens.sessionId,
    sessionActive: vPushTokens.sessionActive,
    createdAt: vPushTokens.createdAt,
    lastSeenAt: vPushTokens.lastSeenAt,
  },
};

/** Bieżąca treść szablonu (`notification_templates`); numer wersji to blokada optymistyczna (ADR 0031). */
export interface NotificationTemplateRecord {
  id: string;
  code: string;
  channel: NotificationChannel;
  title: string | null;
  body: string;
  description: string | null;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

/** Nowe powiadomienie w transakcji zdarzenia (`QUEUED`); `payload` ma parametry szablonu i ekran aplikacji. */
export interface NewNotification {
  userId: string;
  templateCode: string;
  channel: NotificationChannel;
  payload: { params: Record<string, string | number | boolean>; path: string | null };
  dedupeKey: string;
  rentalId?: string | null;
  ticketId?: string | null;
}

export interface NotificationRecord {
  id: number;
  userId: string;
  templateCode: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: NewNotification['payload'];
  title: string | null;
  body: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface PushTokenRecord {
  id: string;
  token: string;
  platform: PushPlatform;
}

/** Wynik wysyłki zapisywany po renderowaniu (ADR 0058): treść, wersja szablonu i identyfikator u bramki. */
export interface NotificationOutcome {
  status: Exclude<NotificationStatus, 'QUEUED'>;
  title: string | null;
  body: string | null;
  templateVersion: number | null;
  providerRef?: string | null;
  error?: string | null;
}

const toTemplate = (r: Row): NotificationTemplateRecord => ({
  id: r.id as string,
  code: r.code as string,
  channel: r.channel as NotificationChannel,
  title: (r.title as string | null) ?? null,
  body: r.body as string,
  description: (r.description as string | null) ?? null,
  version: Number(r.version),
  updatedAt: new Date(r.updated_at as string),
  updatedByName: (r.updated_by_name as string | null) ?? null,
});

const templateSql = sql`SELECT nt.id, nt.code, nt.channel::text AS channel, nt.title, nt.body, nt.description,
                               nt.version, nt.updated_at, s.name AS updated_by_name
                        FROM notification_templates nt LEFT JOIN staff s ON s.id = nt.updated_by`;

const toNotification = (r: Row): NotificationRecord => ({
  id: Number(r.id),
  userId: r.user_id as string,
  templateCode: r.template_code as string,
  channel: r.channel as NotificationChannel,
  status: r.status as NotificationStatus,
  payload: (r.payload as NotificationRecord['payload'] | null) ?? { params: {}, path: null },
  title: (r.title as string | null) ?? null,
  body: (r.body as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  readAt: date(r.read_at),
});

const notificationSql = sql`SELECT n.id, n.user_id, n.template_code, n.channel::text AS channel, n.status::text AS status,
                                   n.payload, n.title, n.body, n.created_at, n.read_at
                            FROM notifications n`;

/**
 * Moduł Powiadomienia (ADR 0058): szablony z wersjami, powiadomienia w kolejce i tokeny push. Repozytorium nie
 * decyduje o wysyłce: reguły (preferencje, tokeny, walidacja i renderowanie szablonu) są w packages/core.
 */
export class DrizzleNotificationRepository {
  constructor(private readonly db: DbExecutor) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | null> {
    return (await this.rows(query))[0] ?? null;
  }

  // --- Powiadomienia ----------------------------------------------------------------------------

  /**
   * Wiersz `QUEUED` w transakcji zdarzenia. Drugie powiadomienie o tym samym zdarzeniu (ten sam `dedupe_key`)
   * pomija unikalny indeks bez przerywania transakcji: wynik `null`.
   */
  async insert(input: NewNotification): Promise<{ id: number } | null> {
    const row = await this.one(sql`
      INSERT INTO notifications (user_id, template_code, channel, payload, dedupe_key, rental_id, ticket_id)
      VALUES (${input.userId}, ${input.templateCode}, ${input.channel}::notification_channel,
              ${JSON.stringify(input.payload)}::jsonb, ${input.dedupeKey}, ${input.rentalId ?? null},
              ${input.ticketId ?? null})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`);
    return row ? { id: Number(row.id) } : null;
  }

  async find(id: number): Promise<NotificationRecord | null> {
    const row = await this.one(sql`${notificationSql} WHERE n.id = ${id}`);
    return row ? toNotification(row) : null;
  }

  async findByDedupeKey(key: string): Promise<NotificationRecord | null> {
    const row = await this.one(sql`${notificationSql} WHERE n.dedupe_key = ${key}`);
    return row ? toNotification(row) : null;
  }

  /**
   * Wynik wysyłki tylko dla powiadomienia w kolejce: powtórzone zadanie nie nadpisze wyniku; `false`, gdy wynik
   * zapisało już inne wykonanie.
   */
  async complete(id: number, outcome: NotificationOutcome): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE notifications
      SET status = ${outcome.status}::notification_status,
          sent_at = ${outcome.status === 'SENT' ? sql`now()` : sql`NULL`},
          title = ${outcome.title}, body = ${outcome.body}, template_version = ${outcome.templateVersion},
          provider_ref = ${outcome.providerRef ?? null}, error = ${outcome.error ?? null}
      WHERE id = ${id} AND status = 'QUEUED'`);
    return (rowCount ?? 0) > 0;
  }

  /** Błąd z potwierdzenia dostarczenia (receipt) przy wysłanym powiadomieniu; status zostaje `SENT`. */
  async setDeliveryError(id: number, error: string): Promise<void> {
    await this.db.execute(sql`UPDATE notifications SET error = ${error} WHERE id = ${id} AND status = 'SENT'`);
  }

  /**
   * Atomowe przejęcie powiadomienia w kolejce przed wysyłką (H z przeglądu iteracji 6): zadanie `notification.send`
   * i `notifications.sweep` nie wyślą tego samego powiadomienia dwa razy. Przejęcie starsze niż `staleBefore`
   * (przerwane wykonanie) można przejąć ponownie. `false`: wysyła je już inne wykonanie albo ma już wynik.
   */
  async claim(id: number, staleBefore: Date): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE notifications SET claimed_at = now()
      WHERE id = ${id} AND status = 'QUEUED' AND (claimed_at IS NULL OR claimed_at < ${staleBefore})`);
    return (rowCount ?? 0) > 0;
  }

  /** Zwolnienie przejęcia po błędzie wysyłki, żeby ponowienie zadania (pg-boss) mogło wysłać od razu. */
  async releaseClaim(id: number): Promise<void> {
    await this.db.execute(sql`UPDATE notifications SET claimed_at = NULL WHERE id = ${id} AND status = 'QUEUED'`);
  }

  /**
   * Powiadomienia w kolejce dłużej niż `olderThan` (zadanie zgubione albo przerwane) do ponownej wysyłki, bez
   * przejętych przez trwającą wysyłkę.
   */
  async stuckQueued(olderThan: Date, limit = 100): Promise<number[]> {
    const rows = await this.rows(sql`
      SELECT id FROM notifications
      WHERE status = 'QUEUED' AND created_at < ${olderThan} AND (claimed_at IS NULL OR claimed_at < ${olderThan})
      ORDER BY created_at LIMIT ${limit}`);
    return rows.map((r) => Number(r.id));
  }

  /** Preferencje klienta (`notify_reservation_end`, `notify_receipts`) z chwili wysyłki. */
  async preferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.one(sql`SELECT notify_reservation_end, notify_receipts FROM users WHERE id = ${userId}`);
    return {
      reservationEnd: (row?.notify_reservation_end as boolean | undefined) ?? true,
      receipts: (row?.notify_receipts as boolean | undefined) ?? true,
    };
  }

  list(query: ListQuery, def: ResourceDefinition<NotificationField> = notificationsResource) {
    return runListQuery<NotificationField, NotificationListItem>(this.db, def, notificationSource, query);
  }

  // --- Tokeny push ------------------------------------------------------------------------------

  async pushTokens(userId: string): Promise<PushTokenRecord[]> {
    const rows = await this.rows(sql`
      SELECT id, expo_token, platform::text AS platform FROM push_tokens WHERE user_id = ${userId} ORDER BY created_at`);
    return rows.map((r) => ({
      id: r.id as string,
      token: r.expo_token as string,
      platform: r.platform as PushPlatform,
    }));
  }

  /**
   * Upsert po tokenie (ADR 0058): token z innego konta przechodzi do nowego, sesja to najnowsza aktywna sesja
   * z rodziny sesji z tokenu dostępowego (po rotacji token dostępowy wskazuje jeszcze poprzednika). Zwraca
   * poprzedniego właściciela, gdy token zmienił konto.
   */
  async upsertPushToken(input: {
    userId: string;
    sessionId: string;
    token: string;
    platform: PushPlatform;
  }): Promise<{ previousUserId: string | null }> {
    const row = await this.one(sql`
      WITH previous AS (SELECT user_id FROM push_tokens WHERE expo_token = ${input.token}),
           session AS (
             SELECT COALESCE(
               (SELECT s.id FROM sessions s
                WHERE s.family_id = (SELECT family_id FROM sessions WHERE id = ${input.sessionId})
                  AND s.revoked_at IS NULL
                ORDER BY s.created_at DESC LIMIT 1),
               (SELECT id FROM sessions WHERE id = ${input.sessionId})) AS id
           )
      INSERT INTO push_tokens (user_id, expo_token, platform, session_id, last_seen_at)
      VALUES (${input.userId}, ${input.token}, ${input.platform}::platform, (SELECT id FROM session), now())
      ON CONFLICT (expo_token) DO UPDATE
        SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, session_id = EXCLUDED.session_id,
            last_seen_at = now()
      RETURNING (SELECT user_id FROM previous) AS previous_user_id`);
    const previous = (row?.previous_user_id as string | null) ?? null;
    return { previousUserId: previous && previous !== input.userId ? previous : null };
  }

  async deletePushToken(userId: string, token: string): Promise<boolean> {
    const { rowCount } = await this.db.execute(
      sql`DELETE FROM push_tokens WHERE user_id = ${userId} AND expo_token = ${token}`,
    );
    return (rowCount ?? 0) > 0;
  }

  /** Tokeny, na które nie wolno już wysyłać (`DeviceNotRegistered`). */
  async deletePushTokens(tokens: readonly string[]): Promise<number> {
    if (!tokens.length) return 0;
    const { rowCount } = await this.db.execute(
      sql`DELETE FROM push_tokens WHERE expo_token IN (${sql.join(
        tokens.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
    return rowCount ?? 0;
  }

  /**
   * Wylogowanie (ADR 0058): sesja jest tylko unieważniana (`revoked_at`), więc `ON DELETE CASCADE` z `sessions`
   * nie działa; tokeny całej rodziny sesji usuwamy jawnie.
   */
  async deleteSessionFamilyTokens(familyId: string): Promise<number> {
    const { rowCount } = await this.db.execute(sql`
      DELETE FROM push_tokens WHERE session_id IN (SELECT id FROM sessions WHERE family_id = ${familyId})`);
    return rowCount ?? 0;
  }

  /** Rotacja tokenu odświeżającego: tokeny push przechodzą do następcy sesji. */
  async moveSessionTokens(fromSessionId: string, toSessionId: string): Promise<void> {
    await this.db.execute(sql`UPDATE push_tokens SET session_id = ${toSessionId} WHERE session_id = ${fromSessionId}`);
  }

  listPushTokens(query: ListQuery, def: ResourceDefinition<PushTokenField> = pushTokensResource) {
    return runListQuery<PushTokenField, PushTokenListItem>(this.db, def, pushTokenSource, query);
  }

  // --- Szablony ---------------------------------------------------------------------------------

  listTemplates(query: ListQuery): Promise<ListResponse<NotificationTemplateListItem>> {
    return runListQuery<TemplateField, NotificationTemplateListItem>(
      this.db,
      notificationTemplatesResource,
      templateSource,
      query,
    );
  }

  async template(id: string): Promise<NotificationTemplateRecord | null> {
    const row = await this.one(sql`${templateSql} WHERE nt.id = ${id}`);
    return row ? toTemplate(row) : null;
  }

  /** Szablon z blokadą wiersza przed zapisem nowej wersji. */
  async lockTemplate(id: string): Promise<NotificationTemplateRecord | null> {
    const row = await this.one(sql`${templateSql} WHERE nt.id = ${id} FOR UPDATE OF nt`);
    return row ? toTemplate(row) : null;
  }

  /** Bieżąca wersja szablonu kodu i kanału: treść z chwili wysyłki (ADR 0058). */
  async templateByCode(code: string, channel: NotificationChannel): Promise<NotificationTemplateRecord | null> {
    const row = await this.one(
      sql`${templateSql} WHERE nt.code = ${code} AND nt.channel = ${channel}::notification_channel`,
    );
    return row ? toTemplate(row) : null;
  }

  async templateVersions(templateId: string): Promise<NotificationTemplateVersionView[]> {
    const rows = await this.rows(sql`
      SELECT version, title, body, staff_name, created_at, is_current
      FROM v_notification_template_versions WHERE template_id = ${templateId} ORDER BY version DESC`);
    return rows.map((r) => ({
      version: Number(r.version),
      title: (r.title as string | null) ?? null,
      body: r.body as string,
      staffName: (r.staff_name as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      current: r.is_current as boolean,
    }));
  }

  async templateVersion(templateId: string, version: number): Promise<{ title: string | null; body: string } | null> {
    const row = await this.one(sql`
      SELECT title, body FROM notification_template_versions WHERE template_id = ${templateId} AND version = ${version}`);
    return row ? { title: (row.title as string | null) ?? null, body: row.body as string } : null;
  }

  /**
   * Nowa wersja treści z blokadą optymistyczną; wiersz `notification_template_versions` zapisuje wyzwalacz
   * `notification_templates_version`. `false`, gdy wersja w międzyczasie się zmieniła.
   */
  async updateTemplate(
    id: string,
    version: number,
    content: { title: string | null; body: string },
    staffId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE notification_templates
      SET title = ${content.title}, body = ${content.body}, updated_by = ${staffId}, updated_at = now(),
          version = version + 1
      WHERE id = ${id} AND version = ${version}`);
    return (rowCount ?? 0) > 0;
  }
}
