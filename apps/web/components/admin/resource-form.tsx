'use client';

/**
 * Wspólny formularz zasobu (ADR 0031, makieta wzorzec-formularz): walidacja tym samym schematem Zod co API,
 * błędy przy polach, konflikt wersji z porównaniem i wczytaniem aktualnej wersji, operacja nieodwracalna
 * w osobnej karcie z potwierdzeniem.
 */
import type { RemovalResult, ResourceDefinition } from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { ConfirmDialog } from './confirm-dialog';
import { AlertIcon } from './icons';
import { fieldLabel, valueLabel } from './labels';

export interface FormFieldSpec {
  name: string;
  kind: 'text' | 'integer' | 'decimal' | 'textarea' | 'chips' | 'select' | 'toggle';
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Wartości dostępne przy tworzeniu, jeśli różnią się od wartości przy edycji. */
  createOptions?: ReadonlyArray<{ value: string; label: string }>;
  optional?: boolean;
  /** Pole ustalane przy tworzeniu (np. numer w tematach MQTT). */
  createOnly?: boolean;
  wide?: boolean;
  hint?: boolean;
}

type Values = Record<string, string | boolean>;
type Errors = Record<string, string>;

interface ResourceFormProps<T extends { id: string; version: number }> {
  resource: ResourceDefinition;
  basePath: string;
  id?: string;
  fields: FormFieldSpec[];
  defaults: Values;
  title: (record: T | null) => string;
  recordLabel: (record: T) => string;
  aside?: (record: T) => ReactNode;
}

const toValue = (v: unknown): string | boolean =>
  typeof v === 'boolean' ? v : v === null || v === undefined ? '' : String(v);

function toPayload(fields: FormFieldSpec[], values: Values, names: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const spec of fields.filter((f) => names.includes(f.name))) {
    const raw = values[spec.name];
    if (spec.kind === 'toggle') payload[spec.name] = raw === true;
    else if (raw === '' || raw === undefined) payload[spec.name] = spec.optional ? null : undefined;
    else if (spec.kind === 'integer' || spec.kind === 'decimal')
      payload[spec.name] = Number(String(raw).replace(',', '.'));
    else payload[spec.name] = String(raw).trim();
  }
  return payload;
}

/** Komunikat dla błędu Zod; ten sam schemat sprawdza API, więc błąd z serwera mapujemy tak samo. */
function issueMessage(issue: {
  code: string;
  input?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  origin?: string;
  divisor?: unknown;
}): string {
  if (issue.code === 'invalid_type' && (issue.input === undefined || issue.input === null))
    return t('validation.required');
  if (issue.code === 'too_small' && issue.origin === 'string')
    return t('validation.too_small_string', { minimum: Number(issue.minimum) });
  if (issue.code === 'too_big' && issue.origin === 'string')
    return t('validation.too_big_string', { maximum: Number(issue.maximum) });
  if (issue.code === 'too_small') return t('validation.too_small', { minimum: Number(issue.minimum) });
  if (issue.code === 'too_big') return t('validation.too_big', { maximum: Number(issue.maximum) });
  if (issue.code === 'not_multiple_of')
    return t('validation.not_multiple_of', { step: String(issue.divisor).replace('.', ',') });
  return t.has(`validation.${issue.code}`) ? t.dynamic(`validation.${issue.code}`) : t('validation.invalid');
}

function issuesToErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !errors[field]) errors[field] = issueMessage(issue as Parameters<typeof issueMessage>[0]);
  }
  return errors;
}

export function ResourceForm<T extends { id: string; version: number }>(props: ResourceFormProps<T>) {
  const { resource, basePath, id, fields, defaults, title, recordLabel, aside } = props;
  const router = useRouter();
  const [record, setRecord] = useState<T | null>(null);
  const [values, setValues] = useState<Values>(defaults);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<T | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = (target: string) =>
    api<T>(`/admin/${resource.name}/${target}`).then((r) => {
      setRecord(r);
      setValues(Object.fromEntries(fields.map((f) => [f.name, toValue((r as Record<string, unknown>)[f.name])])));
      setConflict(null);
      return r;
    });

  useEffect(() => {
    // Wczytanie rekordu tylko przy zmianie identyfikatora; `load` nie zależy od innych danych.
    if (id) load(id).catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [id]);

  const original = record
    ? Object.fromEntries(fields.map((f) => [f.name, toValue((record as Record<string, unknown>)[f.name])]))
    : null;
  const changed = original
    ? fields.filter((f) => !f.createOnly && values[f.name] !== original[f.name]).map((f) => f.name)
    : fields.map((f) => f.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const payload = record
      ? { version: record.version, ...toPayload(fields, values, changed) }
      : toPayload(fields, values, changed);
    const schema = (record ? resource.updateSchema : resource.createSchema) as z.ZodType | undefined;
    const check = schema?.safeParse(payload);
    if (check && !check.success) {
      setErrors(issuesToErrors(check.error.issues));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await api<T>(record ? `/admin/${resource.name}/${record.id}` : `/admin/${resource.name}`, {
        method: record ? 'PATCH' : 'POST',
        json: check?.data ?? payload,
      });
      if (!record) {
        router.replace(`${basePath}/${saved.id}`);
        return;
      }
      await load(saved.id);
      setNotice(t('form.saved'));
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
        setErrors(issuesToErrors(error.details));
      } else if (error instanceof ApiRequestError && error.code === 'ALREADY_EXISTS') {
        const field = (error.details as { field?: string } | undefined)?.field ?? '';
        setErrors({ [field]: t('error.ALREADY_EXISTS') });
      } else if (error instanceof ApiRequestError && error.code === 'CONFLICT' && record) {
        setConflict(await api<T>(`/admin/${resource.name}/${record.id}`));
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    if (!record) return;
    try {
      await api<RemovalResult>(`/admin/${resource.name}/${record.id}?version=${record.version}`, { method: 'DELETE' });
      router.push(basePath);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  if (loadError) {
    return (
      <div className="state card" role="alert">
        <div className="icon danger">
          <AlertIcon />
        </div>
        <h2>{loadError}</h2>
        <Link className="btn" href={basePath}>
          {t('form.backToList')}
        </Link>
      </div>
    );
  }
  if (id && !record)
    return (
      <div className="card" aria-busy="true">
        <span className="skeleton" style={{ width: '40%' }} />
      </div>
    );

  const options = (spec: FormFieldSpec) =>
    (record ? spec.options : (spec.createOptions ?? spec.options)) ??
    (resource.fields[spec.name]?.values ?? []).map((v) => ({ value: v, label: valueLabel(resource, spec.name, v) }));
  const set = (name: string, value: string | boolean) => setValues((v) => ({ ...v, [name]: value }));
  const diff =
    conflict && original
      ? fields.filter((f) => toValue((conflict as Record<string, unknown>)[f.name]) !== original[f.name])
      : [];

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={basePath}>{t.dynamic(`resource.${resource.name}.title`)}</Link>
            <span aria-hidden="true">/</span>
            <span>{record ? recordLabel(record) : t.dynamic(`resource.${resource.name}.newTitle`)}</span>
          </nav>
          <h1>{title(record)}</h1>
          {record && <div className="sub">{t('form.version', { version: record.version })}</div>}
        </div>
        <div className="actions">
          <Link className="btn" href={basePath}>
            {t('common.cancel')}
          </Link>
          <button type="submit" className="btn primary" disabled={saving || (record !== null && changed.length === 0)}>
            {record ? t('common.save') : t('common.create')}
          </button>
        </div>
      </div>

      {conflict && (
        <div className="banner" role="alert" style={{ marginTop: 16 }}>
          <AlertIcon />
          <div>
            <b>{t('form.conflictTitle')}</b>
            {t('form.conflictBody', { version: conflict.version })}
            {showDiff && (
              <ul>
                {diff.map((f) => (
                  <li key={f.name}>
                    {t('form.diffRow', {
                      field: fieldLabel(resource, f.name),
                      current: toValue((conflict as Record<string, unknown>)[f.name]) || t('common.none'),
                      mine: toValue(values[f.name]) || t('common.none'),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setShowDiff((s) => !s)}>
              {showDiff ? t('form.hideDiff') : t('form.showDiff')}
            </button>
            <button type="button" className="btn" onClick={() => void load(conflict.id)}>
              {t('form.loadCurrent')}
            </button>
          </div>
        </div>
      )}
      {formError && (
        <div className="banner danger" role="alert" style={{ marginTop: 16 }}>
          <AlertIcon />
          <span>{formError}</span>
        </div>
      )}
      {notice && (
        <div className="banner ok" role="status" style={{ marginTop: 16 }}>
          <span>{notice}</span>
        </div>
      )}

      <div className="form-grid" style={{ marginTop: 16 }}>
        <div className="card form-card">
          <h2>{t.dynamic(`resource.${resource.name}.section`)}</h2>
          {fields.map((spec) => {
            const inputId = `field-${spec.name}`;
            const error = errors[spec.name];
            const hint = spec.hint ? t.dynamic(`resource.${resource.name}.hints.${spec.name}`) : null;
            const describedBy =
              [error && `${inputId}-error`, hint && `${inputId}-hint`].filter(Boolean).join(' ') || undefined;
            const disabled = spec.createOnly && record !== null;
            const common = { id: inputId, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy, disabled };
            return (
              <div key={spec.name} className={spec.wide || spec.kind === 'textarea' ? 'field wide' : 'field'}>
                <label
                  className="label"
                  htmlFor={spec.kind === 'chips' || spec.kind === 'toggle' ? undefined : inputId}
                  id={`${inputId}-label`}
                >
                  {fieldLabel(resource, spec.name)}{' '}
                  {spec.optional && <span className="opt">{t('common.optional')}</span>}
                </label>
                {(spec.kind === 'text' || spec.kind === 'integer' || spec.kind === 'decimal') && (
                  <input
                    {...common}
                    className="input"
                    inputMode={spec.kind === 'text' ? undefined : spec.kind === 'integer' ? 'numeric' : 'decimal'}
                    value={String(values[spec.name] ?? '')}
                    onChange={(e) => set(spec.name, e.target.value)}
                  />
                )}
                {spec.kind === 'textarea' && (
                  <textarea
                    {...common}
                    className="input"
                    value={String(values[spec.name] ?? '')}
                    onChange={(e) => set(spec.name, e.target.value)}
                  />
                )}
                {spec.kind === 'select' && (
                  <select
                    {...common}
                    className="input"
                    value={String(values[spec.name] ?? '')}
                    onChange={(e) => set(spec.name, e.target.value)}
                  >
                    <option value="" disabled>
                      {t('common.none')}
                    </option>
                    {options(spec).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {spec.kind === 'chips' && (
                  <div
                    className="seg"
                    role="radiogroup"
                    aria-labelledby={`${inputId}-label`}
                    aria-describedby={describedBy}
                  >
                    {options(spec).map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        className="chip"
                        aria-checked={values[spec.name] === o.value}
                        aria-pressed={values[spec.name] === o.value}
                        disabled={disabled}
                        onClick={() => set(spec.name, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {spec.kind === 'toggle' && (
                  <label className="switch">
                    <input
                      {...common}
                      type="checkbox"
                      checked={values[spec.name] === true}
                      onChange={(e) => set(spec.name, e.target.checked)}
                    />
                    {valueLabel(resource, spec.name, values[spec.name] === true)}
                  </label>
                )}
                {error && (
                  <span className="err" id={`${inputId}-error`}>
                    {error}
                  </span>
                )}
                {hint && (
                  <span className="hint" id={`${inputId}-hint`}>
                    {hint}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {record && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {aside?.(record)}
            {resource.deleteMode !== 'none' && (
              <div className="card side-card">
                <h2>{t.dynamic(`resource.${resource.name}.removeTitle`)}</h2>
                <p>{t.dynamic(`resource.${resource.name}.removeBody`)}</p>
                <button type="button" className="btn danger" onClick={() => setConfirmRemove(true)}>
                  {t.dynamic(`resource.${resource.name}.removeAction`)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        danger
        title={t.dynamic(`resource.${resource.name}.removeTitle`)}
        body={t.dynamic(`resource.${resource.name}.removeBody`)}
        action={t.dynamic(`resource.${resource.name}.removeAction`)}
        onConfirm={() => void remove()}
        onClose={() => setConfirmRemove(false)}
      />
    </form>
  );
}
