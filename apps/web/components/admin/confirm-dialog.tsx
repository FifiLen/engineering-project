'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  /** Pola w oknie (np. powód blokady); `disabled` blokuje przycisk, dopóki nie są wypełnione. */
  children?: ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Potwierdzenie operacji nieodwracalnej lub grupowej (natywny `<dialog>`: fokus i Escape z przeglądarki). */
export function ConfirmDialog({ open, title, body, action, danger, children, disabled, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="confirm" onClose={onClose} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      <p>{body}</p>
      {children}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          {t('common.cancel')}
        </button>
        <button type="button" className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm} disabled={disabled}>
          {action}
        </button>
      </div>
    </dialog>
  );
}
