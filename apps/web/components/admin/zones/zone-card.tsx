'use client';

/**
 * Karta edycji strefy nad mapą (makiety 23-panel-strefy): pola zależne od typu, „Granica” z błędami
 * geometrii, stan w strefie, wersja rekordu i przyciski zapisu, dezaktywacji, przywrócenia i usunięcia.
 * Typ ustala się przy tworzeniu (ADR 0047), więc w edycji przełącznik typu jest zablokowany.
 */
import type { ZoneDetails, ZonePolygon, ZoneType } from '@hulajnogi/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDateTime, t } from '../../../lib/i18n';
import {
  AlertIcon,
  CloseIcon,
  FlagIcon,
  InfoIcon,
  LockIcon,
  NoRideIcon,
  ParkingIcon,
  PolygonIcon,
  RestoreIcon,
  TargetIcon,
  TrashIcon,
  UndoIcon,
} from '../icons';
import { ZONE_TYPE_ORDER } from './zone-format';
import { formatHa, pointCount } from './zone-geometry';
import type { EditorTool } from './zone-map';

export interface ZoneForm {
  code: string;
  name: string;
  type: ZoneType | null;
  speedLimitKmh: string;
  capacity: string;
  visibleInApp: boolean;
}

export type FieldErrors = Partial<Record<'code' | 'name' | 'type' | 'speedLimitKmh' | 'capacity', string>>;

export interface GeometryProblem {
  message: string;
  /** Kod błędu API pod komunikatem (makieta strefa-blad-geometrii); błąd z edytora nie ma kodu. */
  code: string | null;
}

interface ZoneCardProps {
  details: ZoneDetails | null;
  form: ZoneForm;
  onForm(patch: Partial<ZoneForm>): void;
  polygon: ZonePolygon | null;
  /** Powierzchnia granicy: z API dla zapisanej, liczona w panelu dla zmienionej (m²). */
  areaM2: number;
  drawingPoints: number;
  tool: EditorTool;
  canWrite: boolean;
  /** Granica edytowalna (jeden wielokąt i uprawnienie do zapisu). */
  geometryEditable: boolean;
  dirty: boolean;
  saving: boolean;
  serviceAreaCode: string | null;
  /** Strefy parkowania, na które nachodzi wolna jazda (informacja, D3). */
  overlaps: string[];
  fieldErrors: FieldErrors;
  geometryProblem: GeometryProblem | null;
  /** Błąd zapisu granicy z API: komunikat nad formularzem i „Przywróć granicę”. */
  geometryRejected: boolean;
  formError: string | null;
  notice: string | null;
  conflict: { version: number; differences: string[] } | null;
  remoteChanged: boolean;
  historyHref: string | null;
  onSave(): void;
  onClose(): void;
  onShowBoundary(): void;
  onResetBoundary(): void;
  onLoadCurrent(): void;
  onDeactivate(): void;
  onRestore(): void;
  onDelete(): void;
}

function Notice({ tone, icon, children }: { tone: 'info' | 'warn' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice zc-notice ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="ic">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function ZoneCard(props: ZoneCardProps) {
  const { details, form, onForm, polygon, canWrite, geometryEditable, fieldErrors, geometryProblem } = props;
  const isNew = details === null;
  const type = form.type;
  const readOnly = !canWrite;
  const title = isNew ? t('zones.card.newTitle') : `${details.code} ${details.name}`;
  const area = props.areaM2;
  const parts = details?.geometry.coordinates.length ?? 1;
  const limitChanged =
    details?.type === 'SLOW' && details.speedLimitKmh !== null && String(details.speedLimitKmh) !== form.speedLimitKmh;

  const boundaryText = polygon
    ? t('zones.card.boundary', { count: pointCount(polygon), ha: formatHa(area) })
    : isNew
      ? props.drawingPoints > 0
        ? t('zones.card.boundaryOpen', { count: props.drawingPoints })
        : t('zones.card.boundaryEmpty')
      : t('zones.card.boundaryParts', { parts, ha: formatHa(area) });
  const boundaryHint = !geometryEditable
    ? isNew || !details || details.polygon !== null || !canWrite
      ? null
      : t('zones.card.multipart')
    : isNew && !polygon
      ? t('zones.card.hintDraw')
      : props.tool === 'delete'
        ? t('zones.card.hintDelete')
        : props.tool === 'draw'
          ? t('zones.card.hintRedraw')
          : t('zones.card.hintEdit');

  const visibleHint = isNew
    ? t('zones.card.visibleNew')
    : type === 'NO_RIDE'
      ? t('zones.card.visibleNoRide')
      : t('zones.card.visible');

  const lastChange = details
    ? details.updatedByName
      ? `${details.updatedByName}, ${formatDateTime(details.updatedAt)}`
      : t('zones.card.systemSeed')
    : null;

  const canSave = canWrite && props.dirty && !props.saving && (!isNew || (polygon !== null && type !== null));

  return (
    <aside className="zc glass-zone" aria-label={isNew ? t('zones.card.newTitle') : t('zones.card.label')}>
      <div className="zc-head">
        <div className="stack zc-titles">
          <h2 className="zc-title">{title}</h2>
          <span className="zc-status">
            {isNew ? (
              <span className="pill muted">{t('zones.card.draft')}</span>
            ) : details.active ? (
              <span className="pill accent">{t('zones.card.active')}</span>
            ) : (
              <span className="pill muted">{t('zones.card.inactive')}</span>
            )}
            <span className="small">
              {isNew ? t('zones.card.unsaved') : t.dynamic(`zones.card.typeOf.${details.type}`)}
            </span>
          </span>
        </div>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={props.onClose}>
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="zc-body">
        {props.conflict && (
          <div className="banner zc-banner" role="alert">
            <div>
              <b>{t('zones.card.conflictTitle')}</b>
              {t('form.conflictBody', { version: props.conflict.version })}
              {props.conflict.differences.length > 0 && (
                <ul>
                  {props.conflict.differences.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn zc-banner-btn" onClick={props.onLoadCurrent}>
                {t('form.loadCurrent')}
              </button>
            </div>
          </div>
        )}
        {props.remoteChanged && !props.conflict && (
          <Notice tone="warn" icon={<InfoIcon />}>
            {t('zones.card.remoteChanged')}{' '}
            <button type="button" className="link" onClick={props.onLoadCurrent}>
              {t('form.loadCurrent')}
            </button>
          </Notice>
        )}
        {props.geometryRejected && (
          <Notice tone="danger" icon={<AlertIcon size={15} />}>
            <b>{t('zones.card.notSavedTitle')}</b> {t('zones.card.notSavedBody')}
          </Notice>
        )}
        {props.formError && (
          <Notice tone="danger" icon={<AlertIcon size={15} />}>
            {props.formError}
          </Notice>
        )}
        {props.notice && (
          <div className="banner ok zc-banner" role="status">
            <span>{props.notice}</span>
          </div>
        )}

        <div className="zc-grid">
          <label className="field">
            <span className="label">{t('resource.zones.fields.code')}</span>
            <input
              className="input zc-input"
              value={form.code}
              maxLength={20}
              placeholder={isNew ? t('zones.card.codePlaceholder') : undefined}
              readOnly={readOnly}
              aria-invalid={Boolean(fieldErrors.code)}
              onChange={(e) => onForm({ code: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="field">
            <span className="label">{t('resource.zones.fields.name')}</span>
            <input
              className="input zc-input"
              value={form.name}
              maxLength={100}
              placeholder={isNew ? t('zones.card.namePlaceholder') : undefined}
              readOnly={readOnly}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(e) => onForm({ name: e.target.value })}
            />
          </label>
          {(fieldErrors.code || fieldErrors.name) && (
            <span className="err zc-wide">{fieldErrors.code ?? fieldErrors.name}</span>
          )}
        </div>

        <div className="field">
          <span className="label" id="zone-type-label">
            {t('resource.zones.fields.type')}
          </span>
          <div className="zc-seg" role="radiogroup" aria-labelledby="zone-type-label">
            {ZONE_TYPE_ORDER.map((value) => {
              // Typ jest niezmienny po utworzeniu; obszar działania jest jeden (indeks częściowy w bazie).
              const disabled = readOnly || !isNew || value === 'SERVICE_AREA';
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  disabled={disabled}
                  className={value === 'SERVICE_AREA' && type !== value ? 'locked' : undefined}
                  onClick={() => onForm({ type: value })}
                >
                  {value === 'SERVICE_AREA' && type !== value && <LockIcon size={12} />}
                  {t.dynamic(`zones.list.typeShort.${value}`)}
                </button>
              );
            })}
          </div>
          {isNew ? (
            <span className="hint">{type ? t('zones.card.typeChosen') : t('zones.card.typeChoose')}</span>
          ) : (
            canWrite && <span className="hint">{t('zones.card.typeLocked')}</span>
          )}
          {fieldErrors.type && <span className="err">{fieldErrors.type}</span>}
        </div>

        {isNew && props.serviceAreaCode && (
          <Notice tone="info" icon={<LockIcon size={13} />}>
            <b>{t('zones.card.oneAreaTitle')}</b> {t('zones.card.oneAreaBody', { code: props.serviceAreaCode })}
          </Notice>
        )}

        {type === 'NO_RIDE' && (
          <Notice tone="danger" icon={<NoRideIcon size={13} />}>
            <b>{t('zones.card.noRideTitle')}</b> {t('zones.card.noRideBody')}
          </Notice>
        )}

        {type === 'SLOW' && (
          <label className="field">
            <span className="label">{t('resource.zones.fields.speedLimitKmh')}</span>
            <span className={fieldErrors.speedLimitKmh ? 'zc-affix error' : 'zc-affix'}>
              <input
                className="input zc-input"
                inputMode="numeric"
                value={form.speedLimitKmh}
                readOnly={readOnly}
                aria-invalid={Boolean(fieldErrors.speedLimitKmh)}
                onChange={(e) => onForm({ speedLimitKmh: e.target.value.replace(/[^\d]/g, '') })}
              />
              <span className="suf">{t('zones.card.kmhUnit')}</span>
            </span>
            {fieldErrors.speedLimitKmh ? (
              <span className="err">{fieldErrors.speedLimitKmh}</span>
            ) : (
              <span className="hint">
                {limitChanged && `${t('zones.card.limitWas', { kmh: details?.speedLimitKmh ?? 0 })} `}
                {limitChanged ? t('zones.card.limitRange') : t('zones.card.limitHint')}
              </span>
            )}
          </label>
        )}

        <div className="field">
          <span className="label">{t('zones.card.boundaryLabel')}</span>
          <div
            className={geometryProblem ? 'zc-boundary error' : !polygon && isNew ? 'zc-boundary focus' : 'zc-boundary'}
          >
            <PolygonIcon />
            <span className="num-text">{boundaryText}</span>
            {(polygon || details) && (
              <button type="button" className="link zc-show" onClick={props.onShowBoundary}>
                <TargetIcon />
                {t('zones.card.show')}
              </button>
            )}
          </div>
          {geometryProblem ? (
            <>
              <span className="err" role="alert">
                <AlertIcon size={13} />
                <span>{geometryProblem.message}</span>
              </span>
              {geometryProblem.code && <span className="code">{geometryProblem.code}</span>}
            </>
          ) : (
            boundaryHint && <span className="hint">{boundaryHint}</span>
          )}
        </div>

        {type === 'SLOW' && props.overlaps.length > 0 && (
          <Notice tone="info" icon={<ParkingIcon size={13} />}>
            {t('zones.card.overlapLead')} <b>{props.overlaps.join(', ')}</b>
            {'. '}
            {t('zones.card.overlapBody')}
          </Notice>
        )}

        {type === 'PARKING' && (
          <label className="field">
            <span className="label">
              {t('resource.zones.fields.capacity')} <span className="opt">{t('common.optional')}</span>
            </span>
            <span className={fieldErrors.capacity ? 'zc-affix error' : 'zc-affix'}>
              <input
                className="input zc-input"
                inputMode="numeric"
                value={form.capacity}
                readOnly={readOnly}
                aria-invalid={Boolean(fieldErrors.capacity)}
                onChange={(e) => onForm({ capacity: e.target.value.replace(/[^\d]/g, '') })}
              />
              <span className="suf">{t('zones.card.scootersUnit')}</span>
            </span>
            {fieldErrors.capacity ? (
              <span className="err">{fieldErrors.capacity}</span>
            ) : (
              <span className="hint">{t('zones.card.capacityHint')}</span>
            )}
          </label>
        )}

        {type !== 'SERVICE_AREA' && (
          <div className="zc-toggle-field">
            <label className="zc-toggle-row">
              <span className="label">{t('resource.zones.fields.visibleInApp')}</span>
              <input
                type="checkbox"
                role="switch"
                className="zc-toggle"
                checked={form.visibleInApp}
                disabled={readOnly}
                onChange={(e) => onForm({ visibleInApp: e.target.checked })}
              />
            </label>
            <span className="hint">{visibleHint}</span>
          </div>
        )}

        {details && (
          <div className="field">
            <span className="label">{t('zones.card.nowInside')}</span>
            <div className="zc-stats">
              <div className="stat">
                <span className="v num">
                  {details.scootersInside}
                  {details.type === 'PARKING' && details.capacity !== null && (
                    <span className="of"> {t('zones.card.ofCapacity', { capacity: details.capacity })}</span>
                  )}
                </span>
                <span className="l">{t('zones.card.scootersLabel', { count: details.scootersInside })}</span>
              </div>
              <div className="stat">
                <span className="v num">{details.ridesInside}</span>
                <span className="l">{t('zones.card.ridesLabel', { count: details.ridesInside })}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="zc-meta">
        {details ? (
          <>
            <span className="stack">
              <span>
                {t('zones.card.versionLead')} <span className="num ink">{details.version}</span>
                {' · '}
                {t('zones.card.lastChange')}
              </span>
              <span className="ink">{lastChange}</span>
            </span>
            {props.historyHref && (
              <Link className="link zc-history" href={props.historyHref}>
                {t('zones.card.history')}
              </Link>
            )}
          </>
        ) : (
          <span>{t('zones.card.newFoot')}</span>
        )}
      </div>

      {canWrite ? (
        <div className="zc-foot">
          <button type="button" className="btn primary" disabled={!canSave} onClick={props.onSave}>
            {isNew ? t('zones.card.create') : t('zones.card.save')}
          </button>
          {isNew ? (
            <button type="button" className="btn" onClick={props.onClose}>
              {t('common.cancel')}
            </button>
          ) : props.geometryRejected ? (
            <button type="button" className="btn" onClick={props.onResetBoundary}>
              <UndoIcon size={15} />
              {t('zones.card.resetBoundary')}
            </button>
          ) : (
            <>
              {!details.active && (
                <button type="button" className="btn" onClick={props.onRestore}>
                  <RestoreIcon />
                  {t('zones.card.restore')}
                </button>
              )}
              {details.type === 'SERVICE_AREA' ? (
                <span className="small zc-right">{t('zones.card.areaRequired')}</span>
              ) : !details.used ? (
                <button type="button" className="btn danger zc-right" onClick={props.onDelete}>
                  <TrashIcon />
                  {t('zones.card.delete')}
                </button>
              ) : (
                details.active && (
                  <button type="button" className="btn danger zc-right" onClick={props.onDeactivate}>
                    <FlagIcon />
                    {t('zones.card.deactivate')}
                  </button>
                )
              )}
            </>
          )}
        </div>
      ) : (
        <div className="zc-foot">
          <span className="small">{t('zones.card.readOnly')}</span>
        </div>
      )}
    </aside>
  );
}
