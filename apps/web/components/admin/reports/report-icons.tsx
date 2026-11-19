/** Ikony pozycji „Raporty” (konturowe 24×24, linia 1,9 jak `icons.tsx`): wykres słupkowy i ikony kart katalogu. */
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ children, size = 18, ...props }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Raporty w nawigacji i pusty stan (makieta: trzy słupki). */
export const ChartBarsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 20V12M10 20V5M15 20v-9M20 20v-5" />
  </Icon>
);

export const CoinIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.7 0-2.8.9-2.8 2.1 0 2.9 5.8 1.4 5.8 4.2 0 1.2-1.2 2.1-3 2.1-1.4 0-2.5-.6-3-1.5M12 6.5v1.4M12 16.3v1.2" />
  </Icon>
);

export const HeatGridIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />
  </Icon>
);
