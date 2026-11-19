'use client';

/**
 * Pole treści w Markdown (ADR 0063, makieta tresci-blok-edycja): pasek narzędzi według profilu pola, źródło
 * z wyróżnionymi znacznikami i wierszami z błędem, podgląd z drzewa `parseMarkdown` (bez HTML) i lista błędów
 * z wierszem. Błędny wiersz parser pomija, a podgląd pokazuje „Wiersz N pominięty do czasu poprawki”.
 * Te same reguły sprawdza API przy zapisie (`422 CONTENT_VALIDATION_FAILED`); błędy z API pokazuje to samo pole.
 */
import { parseMarkdown, type ContentIssueView, type ContentSectionKey, type MarkdownProfile } from '@hulajnogi/shared';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import { MarkdownView } from '../../markdown-view';
import { AlertIcon, BoldIcon, HeadingIcon, ItalicIcon, LinkIcon, ListIcon } from '../icons';
import { Counter, issueMessage, markdownIssues, profileHint, textLength } from './content-common';

/** Znaczniki Markdown w wierszu źródła (kolor akcji jak na makiecie). */
const MARKERS = /(^#{1,6}[ \t]|^[ \t]*(?:[-*]|\d{1,9}\.)[ \t]|\*\*|\*|_|\]\([^)\s]*\)|\[|\\.)/g;

function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  MARKERS.lastIndex = 0;
  while ((match = MARKERS.exec(line))) {
    if (match.index > last) out.push(line.slice(last, match.index));
    out.push(
      <span key={match.index} className="md-m">
        {match[0]}
      </span>,
    );
    last = MARKERS.lastIndex;
    if (match[0].length === 0) MARKERS.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  enabled: boolean;
  apply: (text: string, start: number, end: number) => { text: string; start: number; end: number };
}

const wrap = (before: string, after: string, placeholder: string) => (text: string, start: number, end: number) => {
  const inner = text.slice(start, end) || placeholder;
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + inner.length,
  };
};

/** Przedrostek na początku bieżącego wiersza (nagłówek, element listy). */
const prefixLine = (prefix: string) => (text: string, start: number, end: number) => {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  return {
    text: text.slice(0, lineStart) + prefix + text.slice(lineStart),
    start: start + prefix.length,
    end: end + prefix.length,
  };
};

export interface MarkdownFieldProps {
  id: string;
  label: string;
  /** Dopisek przy etykiecie, np. „(Markdown)”. */
  labelNote?: string;
  value: string;
  onChange: (value: string) => void;
  profile: MarkdownProfile;
  max: number;
  section?: ContentSectionKey;
  readOnly?: boolean;
  /** `split`: źródło i podgląd obok siebie; `toggle`: przełącznik Edycja/Podgląd (wąskie panele). */
  layout?: 'split' | 'toggle';
  /** Błędy tego pola z odpowiedzi API (np. limit znaków liczony w API). */
  serverIssues?: ContentIssueView[];
  minRows?: number;
}

export function MarkdownField(props: MarkdownFieldProps) {
  const { id, label, labelNote, value, onChange, profile, max, section, readOnly, serverIssues = [] } = props;
  const { layout = 'split', minRows = 4 } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const parsed = useMemo(() => parseMarkdown(value, profile), [value, profile]);
  const local = markdownIssues(parsed.issues, 'bodyMd');
  // Błędy z API, których parser w panelu nie widzi (np. wymagane pole); błędy Markdown pokazujemy z panelu.
  const extra = serverIssues.filter((issue) => !issue.code.startsWith('MD_'));
  const issues = [...local, ...extra];
  const badLines = new Set(parsed.issues.map((issue) => issue.line));
  const length = textLength(value);
  const invalid = issues.length > 0 || length > max;
  const errorId = `${id}-errors`;

  const tools: Tool[] = [
    {
      key: 'h',
      label: t('content.editor.heading'),
      icon: <HeadingIcon size={15} />,
      enabled: profile === 'document',
      apply: prefixLine('## '),
    },
    {
      key: 'b',
      label: t('content.editor.bold'),
      icon: <BoldIcon size={15} />,
      enabled: true,
      apply: wrap('**', '**', t('content.editor.boldSample')),
    },
    {
      key: 'i',
      label: t('content.editor.italic'),
      icon: <ItalicIcon size={15} />,
      enabled: true,
      apply: wrap('*', '*', t('content.editor.italicSample')),
    },
    {
      key: 'l',
      label: t('content.editor.list'),
      icon: <ListIcon size={15} />,
      enabled: profile !== 'inline',
      apply: prefixLine('- '),
    },
    {
      key: 'a',
      label: t('content.editor.link'),
      icon: <LinkIcon size={15} />,
      enabled: true,
      apply: wrap('[', '](https://)', t('content.editor.linkSample')),
    },
  ];
  const run = (tool: Tool) => {
    const el = ref.current;
    if (!el || readOnly) return;
    const next = tool.apply(value, el.selectionStart, el.selectionEnd);
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };

  const source = (
    <div className="md-src">
      <div className="md-lines" aria-hidden="true" style={{ minHeight: `${minRows * 1.65}em` }}>
        {value.split('\n').map((line, i) => (
          <div key={i} className={badLines.has(i + 1) ? 'md-ln bad' : 'md-ln'}>
            {line ? highlight(line) : ' '}
          </div>
        ))}
      </div>
      <textarea
        ref={ref}
        id={id}
        className="md-input"
        value={value}
        spellCheck
        readOnly={readOnly}
        aria-invalid={invalid}
        aria-describedby={issues.length ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
  const preview = (
    <div className="md-prev" aria-label={t('content.editor.preview')}>
      <span className="md-prev-label">{t('content.editor.preview')}</span>
      <MarkdownView blocks={parsed.blocks} className="ct-md" />
      {[...badLines].map((line) => (
        <p key={line} className="md-skipped">
          {t('content.editor.skipped', { line })}
        </p>
      ))}
    </div>
  );

  return (
    <div className="field md-field">
      <div className="label-row">
        <label className="label" htmlFor={id}>
          {label} {labelNote && <span className="opt">{labelNote}</span>}
        </label>
        {layout === 'toggle' ? (
          <span className="ct-seg sm" role="group" aria-label={t('content.editor.mode')}>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
              {t('content.editor.edit')}
            </button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
              {t('content.editor.preview')}
            </button>
          </span>
        ) : (
          <Counter value={length} max={max} />
        )}
      </div>
      <div className={invalid ? 'md-box invalid' : 'md-box'}>
        {!readOnly && (layout === 'split' || mode === 'edit') && (
          <div className="md-tools" role="toolbar" aria-label={t('content.editor.tools')}>
            {tools.map((tool) => (
              <button
                key={tool.key}
                type="button"
                className="md-tool"
                title={tool.label}
                aria-label={tool.label}
                disabled={!tool.enabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(tool)}
              >
                {tool.icon}
              </button>
            ))}
            <span className="md-allowed">{t('content.editor.allowed', { allowed: profileHint(profile) })}</span>
          </div>
        )}
        {layout === 'split' ? (
          <div className="md-split">
            {source}
            {preview}
          </div>
        ) : mode === 'edit' ? (
          source
        ) : (
          preview
        )}
      </div>
      {layout === 'toggle' && (
        <span className="hint" style={{ textAlign: 'right' }}>
          <Counter value={length} max={max} />
        </span>
      )}
      {issues.length > 0 && (
        <ul className="ct-issues" id={errorId}>
          {issues.map((issue, i) => (
            <li key={i}>
              <AlertIcon size={14} />
              {issueMessage(issue, { section, profile })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Czy treść ma błędy Markdown albo przekracza limit (zapis zablokowany w panelu, jak w API). */
export const markdownBlocked = (value: string | null | undefined, profile: MarkdownProfile, max: number) =>
  Boolean(value) && (parseMarkdown(value!, profile).issues.length > 0 || textLength(value) > max);
