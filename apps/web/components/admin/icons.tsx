/** Ikony konturowe 24×24, linia 1,9 (design system). */
import type { ReactNode, SVGProps } from 'react';

function Icon({ children, size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
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

type P = SVGProps<SVGSVGElement> & { size?: number };

export const BrandMark = () => (
  <svg
    width="25"
    height="25"
    viewBox="0 0 1024 1024"
    fill="none"
    stroke="#FFFFFF"
    strokeWidth="72"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="314" cy="668" r="88" />
    <circle cx="710" cy="668" r="88" />
    <path d="M402 668 H622M710 668 L614 268M534 268 H684" />
  </svg>
);
export const MapIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
    <path d="M9 4v14M15 6v14" />
  </Icon>
);
export const ListIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Icon>
);
export const ScooterIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="17" r="2.5" />
    <circle cx="18" cy="17" r="2.5" />
    <path d="M8.5 17h7M18 17 15.5 6M13.5 6H17" />
  </Icon>
);
export const SearchIcon = (p: P) => (
  <Icon size={16} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const FilterIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z" />
  </Icon>
);
export const PlusIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ArrowUp = (p: P) => (
  <Icon size={14} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const ArrowDown = (p: P) => (
  <Icon size={14} {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const AlertIcon = (p: P) => (
  <Icon size={22} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16h.01" />
  </Icon>
);
export const LockIcon = (p: P) => (
  <Icon size={16} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const BellIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);
export const WrenchIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2Z" />
  </Icon>
);
