'use client';

import { AccessAreaTabs } from '../areas';

/**
 * Zakładki „Operatorzy i role” (makiety dostep-operatorzy, dostep-role, dostep-audyt, 34-panel-domkniecie): od iteracji 8
 * także Zaproszenia, Sesje i Uprawnienia (ADR 0076); ukryte bez uprawnień.
 */
export function AccessTabs() {
  return <AccessAreaTabs />;
}

export function initials(name: string | null): string {
  return (name ?? '?')
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Osoba w wierszu tabeli: inicjały, imię i druga linia (e-mail albo telefon). */
export function Person({ name, detail }: { name: string; detail?: string | null }) {
  return (
    <span className="person">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="who">
        <span className="strong">{name}</span>
        {detail && <small>{detail}</small>}
      </span>
    </span>
  );
}

/** Podsumowanie i błąd formularza ekranów dostępu; ten sam wygląd co w ResourceForm. */
export function Banner({ kind, children }: { kind: 'ok' | 'danger' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={kind === 'warn' ? 'banner' : `banner ${kind}`} role={kind === 'ok' ? 'status' : 'alert'}>
      <div>{children}</div>
    </div>
  );
}
