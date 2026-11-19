/**
 * Ikony elementów sekcji-list z zamkniętej listy `CONTENT_ICONS` (ADR 0062): ten sam zestaw rysunków w panelu
 * (wybór ikony, podgląd) i na stronie. Aplikacja ma własne rysunki o tych samych nazwach. Kontur 24×24, linia 2.
 */
import type { ContentIcon } from '@hulajnogi/shared';
import type { ReactNode } from 'react';

const PATHS: Record<ContentIcon, ReactNode> = {
  'rider-single': (
    <>
      <circle cx="12" cy="6.5" r="2.5" />
      <path d="M8 21v-6l-1-4a5 5 0 0 1 10 0l-1 4v6" />
    </>
  ),
  'bike-lane': <path d="M8 3 4 21M16 3l4 18M12 4v3M12 11v3M12 18v2" />,
  parking: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
    </>
  ),
  helmet: (
    <>
      <path d="M3 15a9 9 0 0 1 18 0v2H3z" />
      <path d="M12 6v5M3 17h18" />
    </>
  ),
  'no-alcohol': (
    <>
      <path d="M7 3h10l-1.5 9a3.5 3.5 0 0 1-7 0zM12 15.5V21M8.5 21h7" />
      <path d="M4 4l16 16" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  scan: (
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M3 10h18M16 15h1.5" />
      <path d="M6 6V5a1 1 0 0 1 1-1h10" />
    </>
  ),
  battery: (
    <>
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
      <path d="M22 11v2M11.5 9l-2 3h3l-2 3" />
    </>
  ),
  'zone-slow': (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l-3.5-4.5M7 17h10" />
    </>
  ),
  'zone-no-ride': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18 18 6" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
};

export function ContentIconView({ icon, size = 18 }: { icon: ContentIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[icon]}
    </svg>
  );
}
