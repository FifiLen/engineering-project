import {
  diffForAudit,
  DomainError,
  ensureVersion,
  notFound,
  renderTemplate,
  templateIssues,
  validateTemplate,
  type RenderedNotification,
  type TemplateIssue,
  type TemplateValues,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleNotificationRepository,
  type NotificationTemplateRecord,
} from '@hulajnogi/db';
import {
  isNotificationTemplateCode,
  NOTIFICATION_TEMPLATES,
  notificationPath,
  type ListQuery,
  type ListResponse,
  type NotificationTemplateCode,
  type NotificationTemplateDetails,
  type NotificationTemplateListItem,
  type NotificationTemplatePreview,
  type NotificationTemplatePreviewResult,
  type NotificationTemplateRestore,
  type NotificationTemplateUpdate,
  type TemplateParam,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';

/** Parametry kodu z rejestru w packages/shared; kod spoza rejestru (dane sprzed rejestru) nie ma parametrów. */
export function templateParams(code: string): readonly TemplateParam[] {
  return isNotificationTemplateCode(code) ? NOTIFICATION_TEMPLATES[code].params : [];
}

/** Pusty tytuł z formularza to brak tytułu (SMS nie ma tytułu, push go wymaga: walidacja w core). */
const normalizeTitle = (title: string | null) => (title?.trim() ? title : null);

/**
 * Wartości podglądu z formularza według typów z rejestru: liczba do odmiany, wybór i tekst jako napis. Wartości
 * spoza rejestru są pomijane, a brakująca wartość kończy się błędem renderowania w podglądzie.
 */
function previewValues(
  params: readonly TemplateParam[],
  values: NotificationTemplatePreview['values'],
): TemplateValues {
  const result: TemplateValues = {};
  for (const param of params) {
    const value = values[param.name];
    if (value === undefined) continue;
    if (param.type === 'number') {
      const number = typeof value === 'number' ? value : Number(value);
      if (typeof value !== 'boolean' && String(value).trim() !== '' && Number.isFinite(number))
        result[param.name] = number;
    } else {
      result[param.name] = String(value);
    }
  }
  return result;
}

/**
 * Szablony powiadomień (ADR 0058, wymaganie 17): renderowanie bieżącej wersji przy wysyłce (push i kod SMS) oraz
 * edytor w panelu: podgląd z walidacją w core, zapis jako nowa wersja z blokadą optymistyczną, przywrócenie starej
 * treści jako nowa wersja; każdy zapis z wpisem w dzienniku audytu.
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
  ) {}

  /**
   * Treść z bieżącej wersji szablonu kodu (kanał z rejestru). Brak szablonu to `TEMPLATE_MISSING`, a brak wartości
   * parametru `TEMPLATE_RENDER_FAILED` (core).
   */
  async render(
    code: NotificationTemplateCode,
    values: TemplateValues,
    executor: DbExecutor = this.db,
  ): Promise<RenderedNotification & { version: number }> {
    const template = await new DrizzleNotificationRepository(executor).templateByCode(
      code,
      NOTIFICATION_TEMPLATES[code].channel,
    );
    if (!template) throw new DomainError('TEMPLATE_MISSING', { code });
    return { ...renderTemplate(template, values), version: template.version };
  }

  // --- Panel ----------------------------------------------------------------------------------

  list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<NotificationTemplateListItem>> {
    return new DrizzleNotificationRepository(db).listTemplates(query);
  }

  async details(id: string): Promise<NotificationTemplateDetails> {
    const repo = new DrizzleNotificationRepository(this.db);
    const template = await repo.template(id);
    if (!template) throw notFound('notification_template', id);
    return { ...view(template), versions: await repo.templateVersions(id) };
  }

  /**
   * Podgląd w edytorze (bez zapisu): wszystkie problemy szablonu naraz z wierszem i znakiem, a bez problemów treść
   * po renderowaniu na przykładowych wartościach; brak wartości to problem `TEMPLATE_RENDER_FAILED`.
   */
  async preview(id: string, body: NotificationTemplatePreview): Promise<NotificationTemplatePreviewResult> {
    const template = await new DrizzleNotificationRepository(this.db).template(id);
    if (!template) throw notFound('notification_template', id);
    const params = templateParams(template.code);
    const source = { channel: template.channel, title: normalizeTitle(body.title), body: body.body };
    const issues: TemplateIssue[] = templateIssues(source, params);
    if (issues.length) return { issues, rendered: null };
    try {
      return { issues: [], rendered: renderTemplate(source, previewValues(params, body.values)) };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const field = error.details?.field === 'title' ? 'title' : 'body';
      return { issues: [{ code: error.code, field }], rendered: null };
    }
  }

  /** Zapis treści jako nowej wersji (`content.write`); niezmieniona treść nie tworzy wersji. */
  async update(staffId: string, id: string, body: NotificationTemplateUpdate): Promise<NotificationTemplateDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleNotificationRepository(tx);
      const template = await repo.lockTemplate(id);
      if (!template) throw notFound('notification_template', id);
      ensureVersion(body.version, template.version);
      const content = { title: normalizeTitle(body.title), body: body.body };
      validateTemplate({ channel: template.channel, ...content }, templateParams(template.code));
      const changes = diffForAudit({ title: template.title, body: template.body }, content);
      if (!Object.keys(changes).length) return;
      await this.saveVersion(repo, template, content, staffId);
      await audit({
        action: 'notification_template.updated',
        entityType: 'notification_template',
        entityId: id,
        data: {
          code: template.code,
          channel: template.channel,
          changes,
          version: [template.version, template.version + 1],
        },
      });
    });
    return this.details(id);
  }

  /** Przywrócenie treści starszej wersji jako nowej wersji; treść przechodzi walidację z bieżącym rejestrem. */
  async restore(staffId: string, id: string, body: NotificationTemplateRestore): Promise<NotificationTemplateDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleNotificationRepository(tx);
      const template = await repo.lockTemplate(id);
      if (!template) throw notFound('notification_template', id);
      ensureVersion(body.version, template.version);
      const old = await repo.templateVersion(id, body.fromVersion);
      if (!old)
        throw new DomainError('NOT_FOUND', { entity: 'notification_template_version', version: body.fromVersion });
      validateTemplate({ channel: template.channel, ...old }, templateParams(template.code));
      const changes = diffForAudit({ title: template.title, body: template.body }, old);
      if (!Object.keys(changes).length) return;
      await this.saveVersion(repo, template, old, staffId);
      await audit({
        action: 'notification_template.restored',
        entityType: 'notification_template',
        entityId: id,
        data: {
          code: template.code,
          channel: template.channel,
          fromVersion: body.fromVersion,
          changes,
          version: [template.version, template.version + 1],
        },
      });
    });
    return this.details(id);
  }

  private async saveVersion(
    repo: DrizzleNotificationRepository,
    template: NotificationTemplateRecord,
    content: { title: string | null; body: string },
    staffId: string,
  ): Promise<void> {
    if (!(await repo.updateTemplate(template.id, template.version, content, staffId))) {
      throw new DomainError('CONFLICT', { expectedVersion: template.version });
    }
  }
}

function view(template: NotificationTemplateRecord): Omit<NotificationTemplateDetails, 'versions'> {
  const code = template.code as NotificationTemplateCode;
  return {
    id: template.id,
    code,
    channel: template.channel,
    title: template.title,
    body: template.body,
    version: template.version,
    description: template.description,
    params: templateParams(template.code),
    path: isNotificationTemplateCode(template.code) ? notificationPath(code) : null,
    updatedAt: template.updatedAt.toISOString(),
    updatedByName: template.updatedByName,
  };
}
