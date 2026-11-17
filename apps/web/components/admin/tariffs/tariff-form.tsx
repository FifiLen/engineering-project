'use client';

/**
 * Nowa wersja cennika (makieta cennik-nowa-wersja, ADR 0053): wartości z obowiązującej wersji do zmiany,
 * data „od teraz” albo „od daty” (czas polski), porównanie z obowiązującą i skutki przed zapisem.
 * Zapisanej wersji się nie edytuje; limitu prędkości w strefie tu nie ma (D6).
 */
import type { NewTariff, TariffVersionItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatDate, formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { AlertIcon, CalendarIcon, DocumentIcon, LockIcon } from '../icons';
import { isoToWarsawLocal, warsawLocalToIso } from '../payments/payment-format';
import {
  ALL_FIELDS,
  fieldLabel,
  formatValue,
  parseInput,
  TARIFF_SECTIONS,
  toInput,
  unitSuffix,
  VAT_FIELD,
  type TariffField,
} from './tariff-fields';
import { TARIFFS_BASE, useTariffs } from './tariffs';

type Values = Record<TariffField, string>;

/** Domyślna data „od daty”: jutro o północy czasu polskiego. */
function tomorrowMidnight(): string {
  const local = isoToWarsawLocal(new Date(Date.now() + 86_400_000).toISOString());
  return `${local.slice(0, 10)}T00:00`;
}

export function NewTariffPage() {
  const { can } = useSession();
  const router = useRouter();
  const { versions, current, scheduled, error: loadError } = useTariffs();
  const [values, setValues] = useState<Values | null>(null);
  const [mode, setMode] = useState<'now' | 'date'>('date');
  const [date, setDate] = useState(tomorrowMidnight);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!current || values) return;
    setValues(Object.fromEntries(ALL_FIELDS.map((spec) => [spec.field, toInput(spec, current[spec.field])])) as Values);
  }, [current, values]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const nextVersion = (versions?.reduce((max, v) => Math.max(max, v.version), 0) ?? 0) + 1;

  const parsed = useMemo(() => {
    if (!values) return null;
    const out: Partial<Record<TariffField, number>> = {};
    const errors: Partial<Record<TariffField | 'validFrom', string>> = {};
    for (const spec of ALL_FIELDS) {
      const result = parseInput(spec, values[spec.field]);
      if ('error' in result) errors[spec.field] = result.error;
      else out[spec.field] = result.value;
    }
    const validFrom = mode === 'now' ? null : warsawLocalToIso(date);
    if (mode === 'date' && (!validFrom || new Date(validFrom).getTime() <= now)) {
      errors.validFrom = t('tariffs.errors.pastDate');
    }
    return { out, errors, validFrom };
  }, [values, mode, date, now]);

  if (!can('tariffs.write')) return <Banner kind="danger">{t('error.FORBIDDEN')}</Banner>;
  if (!versions || !values || !parsed) {
    return loadError ? <Banner kind="danger">{loadError}</Banner> : <div className="card" aria-busy="true" />;
  }
  if (!current) return <Banner kind="danger">{t('tariffs.noCurrent')}</Banner>;

  const { out, errors, validFrom } = parsed;
  // Pole z błędem też jest zmianą (makieta: „zmiana” przy baterii 120 %).
  const changed = (field: TariffField) => {
    const value = out[field];
    if (value !== undefined) return value !== current[field];
    const spec = ALL_FIELDS.find((s) => s.field === field)!;
    return values[field].trim() !== toInput(spec, current[field]);
  };
  const changes = ALL_FIELDS.filter((s) => changed(s.field)).length + (mode === 'date' ? 1 : 0);
  const errorCount = Object.keys(errors).length;
  const fieldError = (field: TariffField) =>
    errors[field] ?? (serverFields.includes(field) ? t('tariffs.errors.server') : undefined);
  const effective = mode === 'now' ? t('tariffs.form.immediately') : validFrom ? formatDateTime(validFrom) : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (errorCount > 0 || scheduled) return;
    setBusy(true);
    setError(null);
    setServerFields([]);
    try {
      const body: NewTariff = { ...(out as Record<TariffField, number>), validFrom };
      const created = await api<TariffVersionItem>('/admin/tariffs', { method: 'POST', json: body });
      router.push(`${TARIFFS_BASE}?wersja=${created.version}`);
    } catch (err) {
      const fields =
        err instanceof ApiRequestError && err.code === 'TARIFF_INVALID'
          ? ((err.details as { fields?: string[] } | undefined)?.fields ?? [])
          : [];
      setServerFields(fields);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const field = (spec: (typeof ALL_FIELDS)[number]) => {
    const err = fieldError(spec.field);
    const id = `tariff-${spec.field}`;
    return (
      <div key={spec.field} className="field">
        <label className="label" htmlFor={id}>
          {fieldLabel(spec.field)}
          {changed(spec.field) && <span className="chg">{t('tariffs.form.changed')}</span>}
        </label>
        <span className="affix">
          <input
            id={id}
            className={changed(spec.field) ? 'input changed' : 'input'}
            inputMode="decimal"
            value={values[spec.field]}
            aria-invalid={err !== undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setValues({ ...values, [spec.field]: e.target.value })}
          />
          <span className="suf">{unitSuffix(spec)}</span>
        </span>
        {err ? (
          <span className="err" role="alert" id={`${id}-hint`}>
            <AlertIcon size={14} />
            {err}
          </span>
        ) : (
          <span className="hint" id={`${id}-hint`}>
            {changed(spec.field)
              ? [
                  t('tariffs.form.currentValue', { value: formatValue(spec, current[spec.field]) }),
                  t.has(`tariffs.formHints.${spec.field}`) ? t.dynamic(`tariffs.formHints.${spec.field}`) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t.has(`tariffs.formHints.${spec.field}`)
                ? t.dynamic(`tariffs.formHints.${spec.field}`)
                : null}
          </span>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={TARIFFS_BASE}>{t('tariffs.title')}</Link>
            <span aria-hidden="true">/</span>
            <span>{t('tariffs.form.crumb')}</span>
          </nav>
          <h1>{t('tariffs.form.title', { version: nextVersion })}</h1>
          <div className="sub">{t('tariffs.form.sub', { version: current.version })}</div>
        </div>
        <div className="actions">
          <Link className="btn" href={TARIFFS_BASE}>
            {t('common.cancel')}
          </Link>
          <button type="submit" className="btn primary" disabled={busy || errorCount > 0 || scheduled !== null}>
            <CalendarIcon />
            {mode === 'now'
              ? t('tariffs.form.submitNow', { version: nextVersion })
              : t('tariffs.form.submitScheduled', { version: nextVersion })}
          </button>
        </div>
      </div>

      {scheduled && (
        <Banner kind="warn">
          {t('error.TARIFF_ALREADY_SCHEDULED', { version: scheduled.version })}{' '}
          <Link className="link" href={`${TARIFFS_BASE}?wersja=${scheduled.version}`}>
            {t('tariffs.showVersion', { version: scheduled.version })}
          </Link>
        </Banner>
      )}
      {error && (
        <Banner kind="danger">
          <AlertIcon size={16} /> {error}
        </Banner>
      )}

      <div className="tariff-form-grid">
        <section className="card tariff-form">
          <div className="tariff-form-row">
            <div className="field">
              <span className="label" id="valid-from-label">
                {t('tariffs.form.validFrom')}
                {mode === 'date' && <span className="chg">{t('tariffs.form.changed')}</span>}
              </span>
              <div className="zc-seg seg-wide" role="radiogroup" aria-labelledby="valid-from-label">
                {(['now', 'date'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                    {t.dynamic(`tariffs.form.mode.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            {mode === 'date' ? (
              <div className="field">
                <label className="label" htmlFor="tariff-date">
                  {t('tariffs.form.dateTime')}
                </label>
                <input
                  id="tariff-date"
                  type="datetime-local"
                  className="input changed"
                  value={date}
                  aria-invalid={errors.validFrom !== undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
                {errors.validFrom ? (
                  <span className="err" role="alert">
                    <AlertIcon size={14} />
                    {errors.validFrom}
                  </span>
                ) : (
                  <span className="hint">{t('tariffs.form.dateHint')}</span>
                )}
              </div>
            ) : (
              <div className="field">
                <span className="label">{t('tariffs.form.dateTime')}</span>
                <span className="hint now-hint">{t('tariffs.form.nowHint', { version: current.version })}</span>
              </div>
            )}
          </div>
          <div className="tariff-form-row sections">
            <div className="col-fields">
              <span className="fsect">{t('tariffs.sections.fees')}</span>
              {TARIFF_SECTIONS[0]!.fields.map(field)}
              {field(VAT_FIELD)}
            </div>
            <div className="col-fields">
              <span className="fsect">{t('tariffs.sections.reservation')}</span>
              {TARIFF_SECTIONS[1]!.fields.map(field)}
              <span className="fsect">{t('tariffs.sections.safety')}</span>
              {TARIFF_SECTIONS[2]!.fields.map(field)}
            </div>
          </div>
        </section>

        <div className="col">
          <section className="card compare-card">
            <div className="card-head">
              <h2>{t('tariffs.compare.title', { version: current.version })}</h2>
              <span className="small">
                <span className="num ink">{changes}</span> {t('tariffs.compare.changes', { count: changes })}
                {errorCount > 0 && (
                  <span className="bad">
                    {' · '}
                    {t('tariffs.compare.errors', { count: errorCount })}
                  </span>
                )}
              </span>
            </div>
            <div className="cmp head">
              <span>{t('tariffs.compare.field')}</span>
              <span>{t('tariffs.version', { version: current.version })}</span>
              <span>{t('tariffs.version', { version: nextVersion })}</span>
            </div>
            <div className="cmp">
              <span>{t('tariffs.form.validFrom')}</span>
              <span className="old">{formatDateTime(current.validFrom)}</span>
              <span className={errors.validFrom ? 'bad' : 'new'}>{effective || t('common.none')}</span>
            </div>
            {ALL_FIELDS.map((spec) => (
              <div key={spec.field} className="cmp">
                <span>{t.dynamic(`tariffs.short.${spec.field}`)}</span>
                <span className="old">{formatValue(spec, current[spec.field])}</span>
                {errors[spec.field] ? (
                  <span className="bad">
                    {values[spec.field] || t('common.none')} {unitSuffix(spec)}
                  </span>
                ) : changed(spec.field) ? (
                  <span className="new">{formatValue(spec, out[spec.field]!)}</span>
                ) : (
                  <span className="same">{t('tariffs.compare.same')}</span>
                )}
              </div>
            ))}
          </section>

          <section className="card conseq-card">
            <span className="label">{t('tariffs.conseq.title')}</span>
            <div className="conseq">
              <span className="ci">
                <CalendarIcon size={15} />
              </span>
              <span>
                {mode === 'now'
                  ? t('tariffs.conseq.startNow', { version: nextVersion })
                  : t('tariffs.conseq.start', { date: effective, version: nextVersion })}
              </span>
            </div>
            <div className="conseq">
              <span className="ci">
                <LockIcon size={15} />
              </span>
              <span>{t('tariffs.conseq.keep', { version: current.version })}</span>
            </div>
            <div className="conseq">
              <span className="ci">
                <DocumentIcon size={15} />
              </span>
              <span>
                {mode === 'now' || !validFrom
                  ? t('tariffs.conseq.auditNow')
                  : t('tariffs.conseq.audit', { date: formatDate(validFrom), version: nextVersion })}
              </span>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
