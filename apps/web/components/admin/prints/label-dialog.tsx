'use client';

/**
 * Naklejka z kodem QR na karcie hulajnogi (ADR 0041, ADR 0068 D5, makieta wydruki-naklejka-qr): układ z katalogu
 * `SCOOTER_LABEL` (naklejka 60 × 80 mm albo arkusz A4 z sześcioma), podgląd z kodem dla `${PUBLIC_SITE_URL}/h/{numer}`
 * i PDF z wbudowanego układu HTML w API (`POST /admin/documents`), zapisany w Wygenerowanych jako układ wbudowany.
 * Tekst naklejki to sekcja treści `admin.scooter-label`; panel pokazuje ją w podglądzie, gdy operator ma
 * `content.read`.
 */
import {
  markdownPlainText,
  parseMarkdown,
  type ContentSectionView,
  type GeneratedDocumentView,
} from '@hulajnogi/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { AlertIcon, BrandMark, CheckIcon, CloseIcon, DownloadIcon, PrinterIcon, QrIcon, RetryIcon } from '../icons';
import { useGeneratedDocument } from './print-dialog';
import { formatSize, openDocumentFile, shortId, useModal, usePrintableType } from './prints-common';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Numer na naklejce bez „#”: „0007”. */
const plainNumber = (number: number) => String(number).padStart(4, '0');

export function LabelButton({ scooterId, number }: { scooterId: string; number: number }) {
  const type = usePrintableType('SCOOTER_LABEL');
  const [open, setOpen] = useState(false);
  if (!type) return null;
  const layouts = (type.params.find((p) => p.name === 'layout')?.options ?? ['single']).map(String);
  const initial = String(type.params.find((p) => p.name === 'layout')?.default ?? layouts[0]);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <QrIcon size={16} />
        {t('prints.label.open')}
      </button>
      {open && (
        <LabelDialog
          scooterId={scooterId}
          number={number}
          layouts={layouts}
          initialLayout={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LabelDialog({
  scooterId,
  number,
  layouts,
  initialLayout,
  onClose,
}: {
  scooterId: string;
  number: number;
  layouts: string[];
  initialLayout: string;
  onClose: () => void;
}) {
  const ref = useModal();
  const { can } = useSession();
  const [layout, setLayout] = useState(initialLayout);
  const [qr, setQr] = useState<string | null>(null);
  const [text, setText] = useState<{ title: string | null; body: string | null }>({ title: null, body: null });
  const [doc, setDoc] = useState<GeneratedDocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plain = plainNumber(number);
  const url = `${SITE_URL}/h/${plain}`;
  const shownUrl = url.replace(/^https?:\/\//, '');

  useEffect(() => {
    void QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) =>
      setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`),
    );
  }, [url]);

  // Tekst naklejki z sekcji treści (ten sam co w PDF z API); bez `content.read` podgląd pokazuje numer i adres.
  useEffect(() => {
    if (!can('content.read')) return;
    api<ContentSectionView>('/admin/content-sections/admin.scooter-label')
      .then((section) =>
        setText(
          section.header.status === 'PUBLISHED'
            ? {
                title: section.header.title,
                body: section.header.bodyMd
                  ? markdownPlainText(parseMarkdown(section.header.bodyMd, 'inline').blocks)
                  : null,
              }
            : { title: null, body: null },
        ),
      )
      .catch(() => undefined);
  }, [can]);

  const generate = async (retryOf?: string) => {
    setBusy(true);
    setError(null);
    try {
      setDoc(
        retryOf
          ? await api<GeneratedDocumentView>(`/admin/documents/${retryOf}/retry`, { method: 'POST' })
          : await api<GeneratedDocumentView>('/admin/documents', {
              method: 'POST',
              json: { documentType: 'SCOOTER_LABEL', entityId: scooterId, format: 'PDF', params: { layout } },
            }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="pr-dialog pr-label-dialog" onClose={onClose} aria-labelledby="label-title">
      <div className="pr-dlg-head">
        <span className="pr-dlg-ic accent" aria-hidden="true">
          <QrIcon size={20} />
        </span>
        <div className="stack grow">
          <h2 id="label-title">{t('prints.label.title', { number: plain })}</h2>
          <p>{t('prints.label.sub')}</p>
        </div>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="pr-label-grid">
        <div className="pr-label-stage">
          <div className={layout === 'a4x6' ? 'pr-sheet' : 'pr-sheet single'}>
            {Array.from({ length: layout === 'a4x6' ? 6 : 1 }, (_, i) => (
              <div key={i} className="pr-sticker" aria-hidden={i > 0}>
                <span className="pr-sticker-brand">
                  <span className="mark">
                    <BrandMark size={16} />
                  </span>
                  <b>{t('admin.brand')}</b>
                  <span className="kind">{text.title ?? t('prints.label.kind')}</span>
                </span>
                <span className="pr-sticker-qr">
                  {qr && <img src={qr} alt={i === 0 ? t('prints.label.qrAlt', { url }) : ''} />}
                </span>
                <span className="pr-sticker-number num">{plain}</span>
                <span className="pr-sticker-body">
                  {text.body && (
                    <>
                      {text.body}
                      <br />
                    </>
                  )}
                  <b>{shownUrl}</b>
                </span>
              </div>
            ))}
          </div>
          <span className="small">{t.dynamic(`prints.label.preview.${layout}`)}</span>
        </div>

        <div className="pr-label-side">
          <div className="pr-field">
            <span className="label" id="label-layout">
              {t('prints.label.layout')}
            </span>
            <div className="pr-seg" role="radiogroup" aria-labelledby="label-layout">
              {layouts.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={layout === value}
                  disabled={doc !== null}
                  onClick={() => setLayout(value)}
                >
                  {t.dynamic(`prints.params.layout.options.${value}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="pr-box">
            <span className="label">{t('prints.label.codeTitle')}</span>
            <span className="code ink">{url}</span>
            <span>{t('prints.label.codeBody')}</span>
            <span className="muted">{t('prints.label.codeDomain')}</span>
          </div>
          <span className="small">{t('prints.label.builtIn')}</span>
          <span className="grow" />
          {error && (
            <span className="err" role="alert">
              {error}
            </span>
          )}
          {doc ? (
            <LabelResult
              key={doc.id}
              initial={doc}
              onRetry={(id) => void generate(id)}
              onClose={onClose}
              onError={setError}
            />
          ) : (
            <div className="actions pr-dlg-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('common.close')}
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void generate()}>
                <PrinterIcon size={16} />
                {t('prints.print.generate.PDF')}
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Stan naklejki (generowanie, gotowe z nazwą pliku i identyfikatorem wydruku, błąd z ponowieniem) i „Pobierz PDF”. */
function LabelResult({
  initial,
  onRetry,
  onClose,
  onError,
}: {
  initial: GeneratedDocumentView;
  onRetry: (id: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { doc } = useGeneratedDocument(initial);
  const pdf = doc.status === 'SUCCEEDED' ? doc.files.pdf : null;
  return (
    <>
      {pdf ? (
        <div className="pr-ready" role="status">
          <span className="pr-state-ic white" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
          <span className="stack grow">
            <span className="pr-state-title sm">{t('prints.label.ready', { name: pdf.fileName })}</span>
            <span className="small">
              {t('prints.label.readySub', { size: formatSize(pdf.sizeBytes), id: shortId(doc.id) })}
            </span>
          </span>
        </div>
      ) : doc.status === 'FAILED' ? (
        <div className="pr-ready danger" role="alert">
          <span className="pr-state-ic white danger" aria-hidden="true">
            <AlertIcon size={14} />
          </span>
          <span className="stack grow">
            <span className="pr-state-title sm">{t('prints.label.failed')}</span>
            <span className="small">
              {t.has(`prints.errorCodes.${doc.errorCode}`)
                ? t.dynamic(`prints.errorCodes.${doc.errorCode}`)
                : (doc.errorCode ?? '')}
            </span>
          </span>
          <button type="button" className="btn" onClick={() => onRetry(doc.id)}>
            <RetryIcon size={16} />
            {t('prints.print.retry')}
          </button>
        </div>
      ) : (
        <div className="pr-ready" role="status" aria-live="polite">
          <span className="pr-spin" aria-hidden="true" />
          <span className="stack grow">
            <span className="pr-state-title sm">{t('prints.print.generating.PDF')}</span>
            <span className="small">
              {doc.status === 'QUEUED' ? t('prints.print.queued') : t('prints.print.running')}
            </span>
          </span>
        </div>
      )}
      <div className="actions pr-dlg-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!pdf}
          onClick={() => void openDocumentFile(doc.id, 'pdf', pdf).catch((e: unknown) => onError(errorMessage(e)))}
        >
          <DownloadIcon size={16} />
          {t('prints.print.downloadPdf')}
        </button>
      </div>
    </>
  );
}
