'use client';

/**
 * Karta części (wymaganie CRUD dla tabeli `spare_parts`): słownik części z ceną w złotych (API przyjmuje grosze),
 * stan tylko przez przyjęcie dostawy albo korektę, ostatnie ruchy magazynowe i historia zmian z dziennika audytu.
 * Własny formularz zamiast ResourceForm, bo cena jednostkowa jest kwotą w groszach.
 */
import {
  formatPln,
  sparePartCreateSchema,
  sparePartsResource,
  sparePartUpdateSchema,
  type RemovalResult,
  type SparePartDetails,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { formatDateTime, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import { HistoryCard } from '../history-card';
import { AlertIcon, PlusIcon } from '../icons';
import { fieldLabel, valueLabel } from '../labels';
import { parseZloty, zlotyInput } from '../payments/payment-format';
import { PARTS_BASE } from '../service/service-format';
import { MovementDetail, MOVEMENTS_PATH, shortWhen, signedQty, StockQty } from './parts';
import { StockDialog } from './stock-dialog';

interface Values {
  sku: string;
  name: string;
  unitCost: string;
  minStockQty: string;
  active: boolean;
  initialQty: string;
  document: string;
}

const EMPTY: Values = {
  sku: '',
  name: '',
  unitCost: '',
  minStockQty: '0',
  active: true,
  initialQty: '0',
  document: '',
};

const toValues = (p: SparePartDetails): Values => ({
  sku: p.sku,
  name: p.name,
  unitCost: zlotyInput(p.unitCost),
  minStockQty: String(p.minStockQty),
  active: p.active,
  initialQty: '0',
  document: '',
});

const int = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN);

export function PartForm({ id }: { id?: string }) {
  const router = useRouter();
  const { can } = useSession();
  const canWrite = can('service.manage');
  const [part, setPart] = useState<SparePartDetails | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stock, setStock] = useState<'receive' | 'adjust' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const apply = (p: SparePartDetails) => {
    setPart(p);
    setValues(toValues(p));
  };

  useEffect(() => {
    if (!id) return;
    api<SparePartDetails>(`/admin/spare-parts/${id}`)
      .then(apply)
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [id]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const original = part ? toValues(part) : null;
  const changed = original
    ? (['sku', 'name', 'unitCost', 'minStockQty', 'active'] as const).filter((k) => values[k] !== original[k])
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const unitCost = parseZloty(values.unitCost);
    const all = {
      sku: values.sku.trim().toUpperCase(),
      name: values.name.trim(),
      unitCost: unitCost ?? Number.NaN,
      minStockQty: int(values.minStockQty),
      active: values.active,
    };
    const payload: Record<string, unknown> = part
      ? { version: part.version, ...Object.fromEntries(changed.map((k) => [k, all[k]])) }
      : { ...all, initialQty: int(values.initialQty), document: values.document.trim() || null };
    const check = (part ? sparePartUpdateSchema : sparePartCreateSchema).safeParse(payload);
    if (!check.success) {
      const next: Record<string, string> = {};
      for (const issue of check.error.issues) {
        const field = String(issue.path[0] ?? '');
        next[field] ??= field === 'sku' ? t('parts.form.skuInvalid') : t('validation.invalid');
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await api<SparePartDetails>(part ? `/admin/spare-parts/${part.id}` : '/admin/spare-parts', {
        method: part ? 'PATCH' : 'POST',
        json: check.data,
      });
      if (!part) {
        router.replace(`${PARTS_BASE}/${saved.id}`);
        return;
      }
      apply(saved);
      setNotice(t('form.saved'));
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'ALREADY_EXISTS')
        setErrors({ sku: t('error.ALREADY_EXISTS') });
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    if (!part) return;
    try {
      await api<RemovalResult>(`/admin/spare-parts/${part.id}?version=${part.version}`, { method: 'DELETE' });
      router.push(PARTS_BASE);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  if (loadError)
    return (
      <div className="state card" role="alert">
        <div className="icon danger">
          <AlertIcon />
        </div>
        <h2>{loadError}</h2>
        <Link className="btn" href={PARTS_BASE}>
          {t('form.backToList')}
        </Link>
      </div>
    );
  if (id && !part) return <div className="card" aria-busy="true" />;

  const field = (
    key: 'sku' | 'name' | 'unitCost' | 'minStockQty' | 'initialQty' | 'document',
    opts?: { suffix?: string; optional?: boolean; hint?: boolean; wide?: boolean },
  ) => {
    const inputId = `part-${key}`;
    const input = (
      <input
        id={inputId}
        className="input"
        value={values[key]}
        disabled={!canWrite}
        aria-invalid={Boolean(errors[key])}
        inputMode={
          key === 'unitCost' ? 'decimal' : key === 'minStockQty' || key === 'initialQty' ? 'numeric' : undefined
        }
        onChange={(e) => set(key, e.target.value)}
      />
    );
    return (
      <div className={opts?.wide ? 'field wide' : 'field'}>
        <label className="label" htmlFor={inputId}>
          {fieldLabel(sparePartsResource, key)} {opts?.optional && <span className="opt">{t('common.optional')}</span>}
        </label>
        {opts?.suffix ? (
          <span className="affix">
            {input}
            <span className="suf">{opts.suffix}</span>
          </span>
        ) : (
          input
        )}
        {errors[key] && <span className="err">{errors[key]}</span>}
        {opts?.hint && <span className="hint">{t.dynamic(`parts.form.hints.${key}`)}</span>}
      </div>
    );
  };

  return (
    <>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="page-head">
          <div>
            <nav className="crumbs" aria-label={t('form.backToList')}>
              <Link href={PARTS_BASE}>{t('resource.spare-parts.title')}</Link>
              <span aria-hidden="true">/</span>
              <span>{part ? part.sku : t('resource.spare-parts.newTitle')}</span>
            </nav>
            <h1>{part ? part.name : t('resource.spare-parts.newTitle')}</h1>
            {part && (
              <div className="sub">
                {[
                  t('form.version', { version: part.version }),
                  valueLabel(sparePartsResource, 'active', part.active),
                  part.belowMinimum ? t('parts.belowMinimum') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
          <div className="actions">
            {part && canWrite && part.active && (
              <>
                <button type="button" className="btn" onClick={() => setStock('adjust')}>
                  {t('parts.mode.adjust')}
                </button>
                <button type="button" className="btn" onClick={() => setStock('receive')}>
                  <PlusIcon size={16} />
                  {t('parts.receive.short')}
                </button>
              </>
            )}
            <Link className="btn" href={PARTS_BASE}>
              {canWrite ? t('common.cancel') : t('form.backToList')}
            </Link>
            {canWrite && (
              <button
                type="submit"
                className="btn primary"
                disabled={saving || (part !== null && changed.length === 0)}
              >
                {part ? t('common.save') : t('common.create')}
              </button>
            )}
          </div>
        </div>

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card form-card">
              <h2>{t('parts.form.section')}</h2>
              {field('sku', { hint: true })}
              {field('name')}
              {field('unitCost', { suffix: t('tariffs.suffix.money'), hint: true })}
              {field('minStockQty', { suffix: t('parts.suffix.pieces'), hint: true })}
              {!part && field('initialQty', { suffix: t('parts.suffix.pieces'), hint: true })}
              {!part && field('document', { optional: true })}
              <div className="field wide">
                <span className="label">{fieldLabel(sparePartsResource, 'active')}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={values.active}
                    disabled={!canWrite}
                    onChange={(e) => set('active', e.target.checked)}
                  />
                  {valueLabel(sparePartsResource, 'active', values.active)}
                </label>
                <span className="hint">{t('parts.form.hints.active')}</span>
              </div>
            </div>

            {part && (
              <section className="card movements-card">
                <div className="card-head">
                  <h2>{t('parts.movements.title')}</h2>
                  <Link className="link" href={`${MOVEMENTS_PATH}?partId=${part.id}`}>
                    {t('parts.movements.all')}
                  </Link>
                </div>
                {part.movements.length === 0 && <p className="muted">{t('parts.movements.none')}</p>}
                {part.movements.map((m) => (
                  <div key={m.id} className="mv-row">
                    <span className="num" title={formatDateTime(m.createdAt)}>
                      {shortWhen(m.createdAt)}
                    </span>
                    <span>{t.dynamic(`service.movementKind.${m.kind}`)}</span>
                    <span className={m.delta < 0 ? 'num bad' : 'num'}>{signedQty(m.delta)}</span>
                    <span className="num muted">{t('parts.movements.after', { count: m.stockAfter })}</span>
                    <span className="mv-detail">
                      <MovementDetail m={m} />
                    </span>
                    <span className="muted">{m.staffName ?? t('audit.system')}</span>
                  </div>
                ))}
              </section>
            )}
          </div>

          {part && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card side-card">
                <h2>{t('parts.stock.title')}</h2>
                <div className="kv">
                  <span>{fieldLabel(sparePartsResource, 'stockQty')}</span>
                  <StockQty part={part} />
                </div>
                <div className="kv">
                  <span>{fieldLabel(sparePartsResource, 'minStockQty')}</span>
                  <span className="num">{part.minStockQty}</span>
                </div>
                <div className="kv">
                  <span>{fieldLabel(sparePartsResource, 'unitCost')}</span>
                  <span className="num">{formatPln(part.unitCost)}</span>
                </div>
                <div className="kv">
                  <span>{fieldLabel(sparePartsResource, 'used30d')}</span>
                  <span className="num">{part.used30d}</span>
                </div>
              </div>
              <HistoryCard
                path={`/admin/spare-parts/${part.id}/history`}
                resourceName="spare-parts"
                revision={part.version}
              />
              {canWrite && part.active && (
                <div className="card side-card">
                  <h2>{t('resource.spare-parts.removeTitle')}</h2>
                  <p>{t('resource.spare-parts.removeBody')}</p>
                  <button type="button" className="btn danger" onClick={() => setConfirmRemove(true)}>
                    {t('resource.spare-parts.removeAction')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmRemove}
        danger
        title={t('resource.spare-parts.removeTitle')}
        body={t('resource.spare-parts.removeBody')}
        action={t('resource.spare-parts.removeAction')}
        onConfirm={() => void remove()}
        onClose={() => setConfirmRemove(false)}
      />
      {part && stock && (
        <StockDialog
          part={part}
          initialMode={stock}
          onClose={() => setStock(null)}
          onDone={(next, message) => {
            setStock(null);
            apply(next);
            setNotice(message);
          }}
        />
      )}
    </>
  );
}
