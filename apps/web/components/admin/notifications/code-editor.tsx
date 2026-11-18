'use client';

/**
 * Pole treści szablonu z numeracją wierszy i kolorowaniem ICU MessageFormat (makieta szablony-powiadomien).
 * Zwykłe `<textarea>` z przezroczystym tekstem leży na warstwie z kolorowanymi wierszami; obie warstwy mają tę samą
 * czcionkę i szerokość, więc zawijanie się zgadza, a numer stoi przy początku wiersza logicznego.
 */
import type { ReactNode } from 'react';

const KEYWORDS = new Set(['plural', 'select', 'selectordinal', 'number']);

/** Kolorowanie jednego wiersza: nawiasy z nazwą parametru kobaltem, rodzaj argumentu kolorem ostrzeżenia. */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\{\s*)([A-Za-z_][\w]*)?|(\})|(,\s*)(plural|selectordinal|select|number)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > last) out.push(line.slice(last, match.index));
    if (match[1] !== undefined) {
      out.push(
        <span key={match.index} className="ce-p">
          {match[1]}
          {match[2]}
        </span>,
      );
    } else if (match[3]) {
      out.push(
        <span key={match.index} className="ce-p">
          {match[3]}
        </span>,
      );
    } else if (match[5] && KEYWORDS.has(match[5])) {
      out.push(match[4]);
      out.push(
        <span key={match.index} className="ce-k">
          {match[5]}
        </span>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

interface CodeEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Wiersze z błędem (od 1). */
  badLines: ReadonlySet<number>;
  invalid: boolean;
  readOnly: boolean;
  label: string;
  describedBy?: string;
}

export function CodeEditor({ id, value, onChange, badLines, invalid, readOnly, label, describedBy }: CodeEditorProps) {
  const lines = value.split('\n');
  return (
    <div className={invalid ? 'code-editor invalid' : 'code-editor'}>
      <div className="ce-lines" aria-hidden="true">
        {lines.map((line, i) => (
          <div key={i} className={badLines.has(i + 1) ? 'ce-ln bad' : 'ce-ln'}>
            <span className="ce-n">{i + 1}</span>
            {/* Spacja niełamiąca podtrzymuje wysokość pustego wiersza. */}
            <span className="ce-t">{line ? highlight(line) : ' '}</span>
          </div>
        ))}
      </div>
      <textarea
        id={id}
        className="ce-input"
        value={value}
        spellCheck={false}
        readOnly={readOnly}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
