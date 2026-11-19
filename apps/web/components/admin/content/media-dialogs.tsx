'use client';

/**
 * Okna biblioteki mediów (ADR 0064): wysyłka wielu grafik z walidacją (makieta tresci-media-wysylka) i wybór grafiki
 * do sekcji, aktualności albo modelu (makieta tresci-wybor-grafiki). Panel sprawdza typ po sygnaturze pliku, rozmiar
 * i wymiary przed wysyłką, ale decyduje API (`POST /files` z celem `MEDIA`, potem `POST /admin/media`); odrzucone
 * pliki zostają na liście z przyczyną.
 */
import {
  MEDIA_ALT_MAX,
  MEDIA_ALT_MIN,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_DIMENSION,
  MEDIA_UPLOAD_BATCH,
  MEDIA_WARN_DIMENSION,
  mediaKeyFromFileName,
  type FileView,
  type ListResponse,
  type MediaListItem,
  type MediaView,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { AlertIcon, CheckIcon, CloseIcon, ImageIcon, SearchIcon, UploadIcon, WarningIcon } from '../icons';
import { formatBytes, mediaUrl } from './content-common';

/** Natywny `<dialog>` otwierany z kodu (fokus i Escape z przeglądarki). */
function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return ref;
}

type Detected = 'image/jpeg' | 'image/png' | 'image/webp' | 'svg' | 'other';

/** Typ po sygnaturze (jak core `detectImageType`), nie po rozszerzeniu. */
async function detectType(file: File): Promise<Detected> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'svg';
  return 'other';
}

async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

interface UploadItem {
  id: number;
  file: File;
  preview: string | null;
  type: Detected;
  width: number | null;
  height: number | null;
  key: string;
  altText: string;
  /** Odrzucony przed wysyłką (typ, rozmiar, wymiary) albo przez API. */
  rejected: string | null;
  warning: boolean;
  state: 'ready' | 'uploading' | 'done' | 'failed';
  error: string | null;
}

const TYPE_LABEL: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

let nextId = 1;

async function prepare(file: File, taken: Set<string>): Promise<UploadItem> {
  const type = await detectType(file);
  const accepted = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
  const size = accepted ? await readDimensions(file) : null;
  let rejected: string | null = null;
  if (type === 'svg') rejected = t('content.upload.svg');
  else if (!accepted) rejected = t('content.upload.type');
  else if (file.size > MEDIA_MAX_BYTES) rejected = t('content.upload.tooBig', { size: formatBytes(file.size) });
  else if (!size) rejected = t('error.IMAGE_UNREADABLE');
  else if (size.width > MEDIA_MAX_DIMENSION || size.height > MEDIA_MAX_DIMENSION)
    rejected = t('content.upload.tooLarge', { width: size.width, height: size.height, max: MEDIA_MAX_DIMENSION });
  const key = mediaKeyFromFileName(file.name, taken);
  taken.add(key);
  return {
    id: nextId++,
    file,
    preview: accepted ? URL.createObjectURL(file) : null,
    type,
    width: size?.width ?? null,
    height: size?.height ?? null,
    key,
    altText: '',
    rejected,
    warning: Boolean(size && Math.max(size.width, size.height) > MEDIA_WARN_DIMENSION),
    state: 'ready',
    error: null,
  };
}

const altValid = (alt: string) => {
  const length = [...alt.trim()].length;
  return length >= MEDIA_ALT_MIN && length <= MEDIA_ALT_MAX;
};

/** Wysyłka jednej grafiki: plik (`POST /files`, cel `MEDIA`) i wpis biblioteki (`POST /admin/media`). */
export async function uploadMediaFile(file: File): Promise<FileView> {
  const form = new FormData();
  form.append('purpose', 'MEDIA');
  form.append('file', file, file.name);
  return api<FileView>('/files', { method: 'POST', body: form });
}

/**
 * „Dodaj grafiki do biblioteki” (do 10 plików naraz). Klucz podpowiada nazwa pliku, tekst alternatywny jest
 * wymagany. Po zapisie okno zamyka się samo, jeśli wszystkie pliki przeszły; nieudane zostają z przyczyną.
 */
export function MediaUploadDialog({
  open,
  onClose,
  onDone,
  takenKeys = [],
}: {
  open: boolean;
  onClose: () => void;
  onDone: (created: MediaView[]) => void;
  takenKeys?: string[];
}) {
  const ref = useDialog(open);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!open) {
      setItems((list) => {
        for (const item of list) if (item.preview) URL.revokeObjectURL(item.preview);
        return [];
      });
    }
  }, [open]);

  const add = async (files: FileList | File[]) => {
    const taken = new Set([...takenKeys, ...items.map((i) => i.key)]);
    const room = MEDIA_UPLOAD_BATCH - items.length;
    const prepared: UploadItem[] = [];
    for (const file of [...files].slice(0, Math.max(0, room))) prepared.push(await prepare(file, taken));
    setItems((list) => [...list, ...prepared]);
  };
  const update = (id: number, patch: Partial<UploadItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const remove = (id: number) =>
    setItems((list) => {
      const item = list.find((i) => i.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return list.filter((i) => i.id !== id);
    });

  const pending = items.filter((i) => !i.rejected && i.state !== 'done');
  const rejected = items.filter((i) => i.rejected).length;
  const ready = pending.length > 0 && pending.every((i) => altValid(i.altText) && i.key);

  async function submit() {
    setBusy(true);
    const created: MediaView[] = [];
    for (const item of pending) {
      update(item.id, { state: 'uploading', error: null });
      try {
        const file = await uploadMediaFile(item.file);
        const media = await api<MediaView>('/admin/media', {
          method: 'POST',
          json: { fileId: file.id, key: item.key, name: item.file.name, altText: item.altText.trim(), caption: null },
        });
        created.push(media);
        update(item.id, { state: 'done' });
      } catch (e) {
        update(item.id, { state: 'failed', error: errorMessage(e) });
      }
    }
    setBusy(false);
    if (created.length) onDone(created);
    if (created.length === pending.length) onClose();
  }

  return (
    <dialog ref={ref} className="ct-dialog upload" onClose={onClose} aria-labelledby="upload-title">
      <div className="ct-dialog-head">
        <span className="ct-dialog-icon" aria-hidden="true">
          <UploadIcon />
        </span>
        <div>
          <h2 id="upload-title">{t('content.upload.title')}</h2>
          <p>{t('content.upload.lead')}</p>
        </div>
      </div>
      <div
        className={drag ? 'ct-drop on' : 'ct-drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void add(e.dataTransfer.files);
        }}
      >
        <ImageIcon size={22} />
        <span className="grow">
          <b>{t('content.upload.drop')}</b>
          <small>{t('content.upload.limits')}</small>
        </span>
        <button
          type="button"
          className="btn"
          disabled={items.length >= MEDIA_UPLOAD_BATCH || busy}
          onClick={() => input.current?.click()}
        >
          {t('content.upload.choose')}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {items.length > 0 && (
        <>
          <div className="small strong">
            {t('content.upload.summary', { count: items.length, ok: items.length - rejected, rejected })}
          </div>
          <div className="ct-upload-list">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} busy={busy} onChange={update} onRemove={remove} />
            ))}
          </div>
        </>
      )}
      <div className="ct-dialog-foot">
        <span className="small">{t('content.upload.footNote')}</span>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void submit()}>
          {t('content.upload.submit', { count: pending.length })}
        </button>
      </div>
    </dialog>
  );
}

function UploadRow({
  item,
  busy,
  onChange,
  onRemove,
}: {
  item: UploadItem;
  busy: boolean;
  onChange: (id: number, patch: Partial<UploadItem>) => void;
  onRemove: (id: number) => void;
}) {
  const [touched, setTouched] = useState(false);
  const altError = touched && !altValid(item.altText);
  if (item.rejected)
    return (
      <div className="ct-upload rejected">
        <span className="ct-upload-thumb bad" aria-hidden="true">
          <AlertIcon size={20} />
        </span>
        <div className="grow">
          <div className="ct-upload-name">
            <b>{item.file.name}</b>
            <span className="small num">{formatBytes(item.file.size)}</span>
          </div>
          <div className="err ct-line">
            <AlertIcon size={14} />
            {t('content.upload.rejected', { reason: item.rejected })}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn plain"
          aria-label={t('content.upload.remove')}
          onClick={() => onRemove(item.id)}
        >
          <CloseIcon size={16} />
        </button>
      </div>
    );
  return (
    <div className="ct-upload">
      <span className="ct-upload-thumb">
        {item.preview && <img src={item.preview} alt="" width={72} height={56} />}
      </span>
      <div className="grow">
        <div className="ct-upload-name">
          <b>{item.file.name}</b>
          <span className={item.warning ? 'small num warn-text' : 'small num'}>
            {[
              TYPE_LABEL[item.type],
              item.width && t('content.media.size', { width: item.width, height: item.height ?? 0 }),
              formatBytes(item.file.size),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="grow" />
          {item.state === 'done' && (
            <span className="ct-ok" role="img" aria-label={t('content.upload.done')}>
              <CheckIcon size={14} />
            </span>
          )}
          {item.state === 'uploading' && <span className="small">{t('content.upload.uploading')}</span>}
          {item.state === 'ready' && !busy && (
            <button
              type="button"
              className="icon-btn plain"
              aria-label={t('content.upload.remove')}
              onClick={() => onRemove(item.id)}
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
        {item.warning && (
          <div className="ct-line warn-text small">
            <WarningIcon size={14} />
            {t('content.upload.wide', {
              width: Math.max(item.width ?? 0, item.height ?? 0),
              warn: MEDIA_WARN_DIMENSION,
            })}
          </div>
        )}
        <div className="ct-upload-fields">
          <label className="field">
            <span className="label">{t('resource.media.fields.key')}</span>
            <input
              className="input mono"
              value={item.key}
              disabled={item.state === 'done' || busy}
              onChange={(e) => onChange(item.id, { key: e.target.value.toLowerCase() })}
            />
          </label>
          <label className="field">
            <span className="label">{t('resource.media.fields.altText')}</span>
            <input
              className="input"
              value={item.altText}
              maxLength={MEDIA_ALT_MAX}
              placeholder={t('content.upload.altPlaceholder')}
              aria-invalid={altError}
              disabled={item.state === 'done' || busy}
              onBlur={() => setTouched(true)}
              onChange={(e) => onChange(item.id, { altText: e.target.value })}
            />
          </label>
        </div>
        {altError && (
          <div className="err ct-line">
            <AlertIcon size={14} />
            {t('content.upload.altRequired', { min: MEDIA_ALT_MIN })}
          </div>
        )}
        {item.error && (
          <div className="err ct-line">
            <AlertIcon size={14} />
            {item.error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pozycja okna wyboru: grafika węższa niż wymaga sekcja jest „za mała” i nie da się jej wybrać. */
function tooNarrow(media: Pick<MediaListItem, 'width'>, minWidth?: number) {
  return minWidth !== undefined && media.width < minWidth;
}

/**
 * „Wybierz grafikę: {sekcja}” (makieta tresci-wybor-grafiki): wyszukiwanie, „Rendery hulajnogi” (grafiki systemowe),
 * „Dodaj nową” z oknem wysyłki, tekst alternatywny wybranej grafiki (zmienia się w Mediach, działa wszędzie).
 */
export function MediaPicker({
  open,
  title,
  minWidth,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  minWidth?: number;
  selectedId: string | null;
  onSelect: (media: MediaListItem) => void;
  onClose: () => void;
}) {
  const ref = useDialog(open);
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [system, setSystem] = useState(false);
  const [data, setData] = useState<ListResponse<MediaListItem> | null>(null);
  const [chosen, setChosen] = useState<MediaListItem | null>(null);
  const [upload, setUpload] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ pageSize: '100', facets: 'isSystem' });
    if (q.trim()) params.set('q', q.trim());
    if (system) params.set('isSystem', 'true');
    const timer = setTimeout(() => {
      api<ListResponse<MediaListItem>>(`/admin/media?${params}`, { signal: controller.signal })
        .then(setData)
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, q, system, reload]);

  useEffect(() => {
    if (open) setChosen(null);
  }, [open]);

  const current = chosen ?? data?.items.find((m) => m.id === selectedId) ?? null;
  const systemCount = data?.facets.isSystem?.true ?? 0;
  const allCount = data ? Object.values(data.facets.isSystem ?? {}).reduce((a, b) => a + b, 0) : 0;

  return (
    <dialog ref={ref} className="ct-dialog picker" onClose={onClose} aria-labelledby="picker-title">
      <div className="ct-dialog-title">
        <h2 id="picker-title">{t('content.picker.title', { section: title })}</h2>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">{t('list.search')}</span>
          <input
            type="search"
            value={q}
            placeholder={t('resource.media.searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button type="button" className="chip" aria-pressed={!system} onClick={() => setSystem(false)}>
          {t('common.all')}
          {data && !q && <span className="n num">{allCount}</span>}
        </button>
        <button type="button" className="chip" aria-pressed={system} onClick={() => setSystem(true)}>
          {t('content.picker.renders')}
          {data && !q && <span className="n num">{systemCount}</span>}
        </button>
        <span className="spacer" />
        {can('content.write') && (
          <button type="button" className="btn" onClick={() => setUpload(true)}>
            <UploadIcon size={16} />
            {t('content.picker.addNew')}
          </button>
        )}
      </div>
      <div className="ct-media-grid picker" aria-busy={!data}>
        {data?.items.map((media) => {
          const narrow = tooNarrow(media, minWidth);
          const on = current?.id === media.id;
          return (
            <button
              key={media.id}
              type="button"
              className={['mcard', on && 'on', narrow && 'off'].filter(Boolean).join(' ')}
              disabled={narrow}
              aria-pressed={on}
              onClick={() => setChosen(media)}
            >
              <span className="mthumb">
                <img src={mediaUrl(media.url)} alt="" loading="lazy" width={media.width} height={media.height} />
                {on && (
                  <span className="mcheck" aria-hidden="true">
                    <CheckIcon size={13} />
                  </span>
                )}
              </span>
              <span className="nm">{media.name}</span>
              <span className="mt">
                <span className="num">{t('content.media.size', { width: media.width, height: media.height })}</span>
                <span>
                  {narrow ? t('content.picker.tooSmall') : t('content.media.usages', { count: media.usages })}
                </span>
              </span>
            </button>
          );
        })}
        {data && data.items.length === 0 && <p className="small">{t('list.noResultsTitle')}</p>}
      </div>
      {current && (
        <div className="ct-picked">
          <img src={mediaUrl(current.url)} alt="" width={52} height={52} />
          <div>
            <b>{current.name}</b>
            <span className="small">{t('content.picker.alt', { alt: current.altText })}</span>
          </div>
        </div>
      )}
      <div className="ct-dialog-foot">
        <span className="small">
          {minWidth ? t('content.picker.minWidth', { section: title, width: minWidth }) : t('content.picker.note')}
        </span>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!current || tooNarrow(current, minWidth)}
          onClick={() => current && onSelect(current)}
        >
          {t('content.picker.select')}
        </button>
      </div>
      <MediaUploadDialog
        open={upload}
        onClose={() => setUpload(false)}
        onDone={() => setReload((n) => n + 1)}
        takenKeys={data?.items.map((m) => m.key)}
      />
    </dialog>
  );
}

/**
 * Pole formularza z grafiką z biblioteki (np. zdjęcie modelu, ADR 0064): miniatura, „Wybierz grafikę” z oknem
 * wyboru i „Usuń”. Wartością pola jest identyfikator grafiki; opis wybranej grafiki trzyma pole.
 */
export function MediaFieldInput({
  id,
  value,
  initial,
  title,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  initial: Pick<MediaListItem, 'id' | 'key' | 'url' | 'altText'> | null;
  title: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [picked, setPicked] = useState<Pick<MediaListItem, 'id' | 'key' | 'url' | 'altText'> | null>(initial);
  const [open, setOpen] = useState(false);
  const shown = value && picked?.id === value ? picked : value && initial?.id === value ? initial : null;
  return (
    <div className="ct-media-field" id={id}>
      {shown ? (
        <>
          <span className="ct-thumb lg">
            <img src={mediaUrl(shown.url)} alt="" width={64} height={64} />
          </span>
          <span className="grow stack">
            <b>{shown.key}</b>
            <span className="small">{t('content.editor.alt', { alt: shown.altText })}</span>
          </span>
        </>
      ) : (
        <span className="grow small">{t('content.editor.noMedia')}</span>
      )}
      {!disabled && (
        <span className="actions">
          {value && (
            <button type="button" className="btn" onClick={() => onChange('')}>
              {t('content.editor.clearMedia')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            <ImageIcon size={15} />
            {value ? t('content.editor.changeMediaShort') : t('content.editor.pickMedia')}
          </button>
        </span>
      )}
      <MediaPicker
        open={open}
        title={title}
        selectedId={value || null}
        onClose={() => setOpen(false)}
        onSelect={(media) => {
          setPicked(media);
          onChange(media.id);
          setOpen(false);
        }}
      />
    </div>
  );
}
