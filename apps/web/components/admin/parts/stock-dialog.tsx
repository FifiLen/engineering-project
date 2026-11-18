'use client';

/**
 * Przyjęcie dostawy albo korekta stanu części (makieta czesci-magazyn): oba polecenia zmieniają stan w jednej
 * transakcji z blokadą wiersza i wpisem w dzienniku audytu (`sp_part_receive`, `sp_part_adjust`).
 */
import {
  PART_ADJUST_REASONS,
  type PartAdjustReason,
  type SparePartDetails,
  type SparePartListItem,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { AlertIcon, ArrowRightIcon, BoxIcon, DocumentIcon, PlusIcon } from '../icons';
import { parseZloty, zlotyInput } from '../payments/payment-format';

type Mode = 'receive' | 'adjust';

interface StockDialogProps {
  part: Pick<SparePartListItem, 'id' | 'sku' | 'name' | 'version' | 'stockQty' | 'minStockQty' | 'unitCost'>;
  initialMode?: Mode;
  onClose: () => void;
  /** Część po zmianie (odpowiedź API) i komunikat do banera. */
  onDone: (part: SparePartDetails, message: string) => void;
}

const parseQty = (raw: string): number | null => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

export function StockDialog({ part, initialMode = 'receive', onClose, onDone }: StockDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [qtyRaw, setQtyRaw] = useState('');
  const [priceRaw, setPriceRaw] = useState('');
  const [document, setDocument] = useState('');
  const [newQtyRaw, setNewQtyRaw] = useState(String(part.stockQty));
  const [reason, setReason] = useState<PartAdjustReason>('STOCKTAKE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const qty = parseQty(qtyRaw);
  const price = priceRaw.trim() === '' ? null : parseZloty(priceRaw);
  const newQty = parseQty(newQtyRaw);
  const noteRequired = mode === 'adjust' && reason === 'OTHER';

  const receiveValid = qty !== null && qty > 0 && qty <= 100_000 && (priceRaw.trim() === '' || price !== null);
  const adjustValid =
    newQty !== null && newQty <= 100_000 && newQty !== part.stockQty && (!noteRequired || note.trim() !== '');
  const valid = mode === 'receive' ? receiveValid : adjustValid;
  const after = mode === 'receive' ? part.stockQty + (qty ?? 0) : (newQty ?? part.stockQty);
  const beforeLow = part.stockQty < part.minStockQty;
  const afterLow = after < part.minStockQty;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'receive') {
        const next = await api<SparePartDetails>(`/admin/spare-parts/${part.id}/receipts`, {
          method: 'POST',
          json: { version: part.version, quantity: qty, unitCost: price, document: document.trim() || null },
        });
        onDone(next, t('parts.receive.done', { count: qty ?? 0, name: part.name }));
      } else {
        const next = await api<SparePartDetails>(`/admin/spare-parts/${part.id}/adjustments`, {
          method: 'POST',
          json: { version: part.version, newQty, reason, note: note.trim() || null },
        });
        onDone(next, t('parts.adjust.done', { name: part.name, count: newQty ?? 0 }));
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const minHint = afterLow
    ? t('parts.cmp.stillBelow', { min: part.minStockQty })
    : beforeLow
      ? t('parts.cmp.leavesBelow', { min: part.minStockQty })
      : t('parts.cmp.min', { min: part.minStockQty });

  return (
    <dialog ref={ref} className="end-dialog stock-dialog" onClose={onClose} aria-labelledby="stock-title">
      <div className="end-head">
        <span className="end-icon accent" aria-hidden="true">
          <BoxIcon size={20} />
        </span>
        <div>
          <h2 id="stock-title">{mode === 'receive' ? t('parts.receive.title') : t('parts.adjust.title')}</h2>
          <p>
            {part.name}
            {' · '}
            <span className="code">{part.sku}</span>
            {' · '}
            {t('parts.version', { version: part.version })}
          </p>
        </div>
      </div>

      <div className="zc-seg" role="radiogroup" aria-label={t('parts.modeLabel')}>
        {(['receive', 'adjust'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
            {t.dynamic(`parts.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'receive' ? (
        <>
          <div className="stock-grid">
            <label className="field">
              <span className="label">{t('parts.receive.quantity')}</span>
              <span className="affix">
                <input
                  className="input"
                  inputMode="numeric"
                  value={qtyRaw}
                  autoFocus
                  aria-invalid={qtyRaw !== '' && !(qty && qty > 0)}
                  onChange={(e) => setQtyRaw(e.target.value)}
                />
                <span className="suf">{t('parts.suffix.pieces')}</span>
              </span>
              <span className="hint">{t('parts.receive.quantityHint')}</span>
            </label>
            <label className="field">
              <span className="label">
                {t('parts.receive.unitCost')} <span className="opt">{t('parts.optionalF')}</span>
              </span>
              <span className="affix">
                <input
                  className="input"
                  inputMode="decimal"
                  value={priceRaw}
                  placeholder={zlotyInput(part.unitCost)}
                  aria-invalid={priceRaw.trim() !== '' && price === null}
                  onChange={(e) => setPriceRaw(e.target.value)}
                />
                <span className="suf">{t('tariffs.suffix.money')}</span>
              </span>
              <span className="hint">{t('parts.receive.unitCostHint')}</span>
            </label>
          </div>
          <label className="field">
            <span className="label">
              {t('parts.receive.document')} <span className="opt">{t('parts.optionalM')}</span>
            </span>
            <input
              className="input"
              value={document}
              maxLength={200}
              placeholder={t('parts.receive.documentPlaceholder')}
              onChange={(e) => setDocument(e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span className="label">{t('parts.adjust.newQty')}</span>
            <span className="affix">
              <input
                className="input"
                inputMode="numeric"
                value={newQtyRaw}
                autoFocus
                aria-invalid={newQty === null}
                onChange={(e) => setNewQtyRaw(e.target.value)}
              />
              <span className="suf">{t('parts.suffix.pieces')}</span>
            </span>
            <span className="hint">{t('parts.adjust.newQtyHint')}</span>
          </label>
          <div role="radiogroup" aria-label={t('parts.adjust.reason')} className="reason-grid-wrap">
            <span className="label">{t('parts.adjust.reason')}</span>
            <div className="reason-grid">
              {PART_ADJUST_REASONS.map((r) => (
                <label key={r} className="radio-option">
                  <input type="radio" name="adjust-reason" checked={reason === r} onChange={() => setReason(r)} />
                  <span>{t.dynamic(`service.adjustReason.${r}`)}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="label">
              {t('parts.adjust.note')}{' '}
              <span className="opt">
                {noteRequired ? t('rentals.end.noteRequired') : t('rentals.end.noteOptional')}
              </span>
            </span>
            <textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
        </>
      )}

      <div className="stock-cmp">
        <span className="stack">
          <span className="small">{t('parts.cmp.now')}</span>
          <span className={beforeLow ? 'big bad' : 'big'}>{part.stockQty}</span>
        </span>
        <ArrowRightIcon size={18} className="muted" />
        <span className="stack">
          <span className="small">{mode === 'receive' ? t('parts.cmp.afterReceive') : t('parts.cmp.afterAdjust')}</span>
          <span className={afterLow ? 'big bad' : 'big'}>{after}</span>
        </span>
        <span className="small hint-right">{minHint}</span>
      </div>

      <div className="conseq-list">
        <div className="conseq">
          <span className="ci">
            <BoxIcon size={15} />
          </span>
          <span>
            {mode === 'receive'
              ? t('parts.receive.conseqStock', { count: qty ?? 0 })
              : t('parts.adjust.conseqStock', { before: part.stockQty, after })}
          </span>
        </div>
        <div className="conseq">
          <span className="ci">
            <DocumentIcon size={15} />
          </span>
          <span>{mode === 'receive' ? t('parts.receive.conseqAudit') : t('parts.adjust.conseqAudit')}</span>
        </div>
      </div>

      {error && (
        <div className="banner danger" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={busy || !valid} onClick={() => void submit()}>
          {mode === 'receive' ? <PlusIcon size={16} /> : null}
          {mode === 'receive'
            ? t('parts.receive.submit', { count: qty ?? 0 })
            : t('parts.adjust.submit', { count: newQty ?? part.stockQty })}
        </button>
      </div>
    </dialog>
  );
}
