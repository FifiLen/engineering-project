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

/** Znak marki: biały na kobaltowym tle w nawigacji, kobaltowy na białym na ekranie logowania. */
export const BrandMark = ({ size = 25, color = '#FFFFFF' }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    fill="none"
    stroke={color}
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

export const LogoutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l-5-5 5-5M5 12h11" />
  </Icon>
);

export const BackIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const CopyIcon = (p: P) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12l5 5 9-10" />
  </Icon>
);

export const DocumentIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 13h6M10 17h6" />
  </Icon>
);

export const UsersIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5" />
    <path d="M16 4.5a3.5 3.5 0 010 7M18 15c2 .6 3.2 2.2 3.8 5" />
  </Icon>
);

export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const RouteIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7a3 3 0 000-6H9a3 3 0 010-6h7" />
  </Icon>
);

export const StopIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const ParkingIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M10 16V8h3a2.5 2.5 0 010 5h-3" />
  </Icon>
);

export const ChevronRightIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const WarningIcon = (p: P) => (
  <Icon size={14} strokeWidth={2} {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

// Edytor stref (makiety 23-panel-strefy)
export const SlowZoneIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M4.5 17a8.5 8.5 0 1115 0" />
    <path d="M12 13l4-4" />
  </Icon>
);

export const NoRideIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </Icon>
);

export const PolygonIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <path d="M5 9l7-5 7 4-2 10H7z" />
    <circle cx="5" cy="9" r="1.2" />
    <circle cx="12" cy="4" r="1.2" />
    <circle cx="19" cy="8" r="1.2" />
    <circle cx="17" cy="18" r="1.2" />
    <circle cx="7" cy="18" r="1.2" />
  </Icon>
);

export const TargetIcon = (p: P) => (
  <Icon size={14} strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Icon>
);

export const FlagIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M5 21V4h11l-2 4 2 4H5" />
  </Icon>
);

export const PencilIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Icon>
);

export const RestoreIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7" />
    <path d="M4 4v4h4" />
  </Icon>
);

export const EyeOffIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.8 9.8 0 0112 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.5 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1" />
  </Icon>
);

export const SortIcon = (p: P) => (
  <Icon size={14} strokeWidth={2} {...p}>
    <path d="M8 5v14M4 9l4-4 4 4" />
    <path d="M14 9h6M14 13h4M14 17h2" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon size={14} strokeWidth={2} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const InfoIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const MinusIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const CardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Icon>
);

export const TagIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 12.6V4.5A1.5 1.5 0 014.5 3h8.1a1.5 1.5 0 011.06.44l6.9 6.9a1.5 1.5 0 010 2.12l-8.1 8.1a1.5 1.5 0 01-2.12 0l-6.9-6.9A1.5 1.5 0 013 12.6Z" />
    <path d="M8 8h.01" />
  </Icon>
);

export const HistoryIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <path d="M3.5 12a8.5 8.5 0 102.5-6" />
    <path d="M3 4v4h4M12 8v4l3 2" />
  </Icon>
);

export const CalendarIcon = (p: P) => (
  <Icon size={16} strokeWidth={2} {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const ReceiptIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icon>
);

export const PhoneIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 17.5h2" />
  </Icon>
);

export const PersonIcon = (p: P) => (
  <Icon size={15} strokeWidth={2} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c1.2-3.5 4-5 7.5-5s6.3 1.5 7.5 5" />
  </Icon>
);

// Iteracja 6 (makiety 27-panel-serwis): pulpit, serwis, magazyn, powiadomienia, symulator.

export const GridIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </Icon>
);

/** Klucz serwisowy z nawigacji (Zgłoszenia, „Utwórz zadanie”, „Wyślij do serwisu”). */
export const ServiceIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14.5 5.5a4 4 0 00-5 5L4 16l4 4 5.5-5.5a4 4 0 005-5l-2.5 2.5-2.5-.5-.5-2.5z" />
  </Icon>
);

export const BriefcaseIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 12h18M10 12v2h4v-2" />
  </Icon>
);

export const BoxIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </Icon>
);

export const ChipIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </Icon>
);

export const NotificationIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 004 0" />
  </Icon>
);

export const WifiOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 3l18 18" />
    <path d="M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.8M14.4 10.2A10 10 0 0119 12.9M2 9.3a15 15 0 014.3-2.6M10.7 5.1A15 15 0 0122 9.3" />
    <path d="M12 20h.01" />
  </Icon>
);

export const BatteryIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
    <path d="M22 11v2" />
    <path d="M6 10.5v3" />
  </Icon>
);

export const MuteIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M17 9l5 6M22 9l-5 6" />
  </Icon>
);

/** Zakaz: „Wyłącz z ruchu”, wjazd w strefę zakazu. */
export const BanIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </Icon>
);

export const PinIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);

export const PlayIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 4.5v15l12.5-7.5z" />
  </Icon>
);

export const SquareIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);

export const TruckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Icon>
);

export const WalletIcon = (p: P) => (
  <Icon {...p}>
    <path d="M19 7V5.5A1.5 1.5 0 0017.5 4H6a2 2 0 000 4h13a1 1 0 011 1v10a1 1 0 01-1 1H6a2 2 0 01-2-2V6" />
    <path d="M16 14h.01" />
  </Icon>
);

export const DownloadIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);

export const ArrowRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ImageIcon = (p: P) => (
  <Icon size={14} {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M3.5 15l4.5-4 4 3.5 3-2.5 5.5 4.5" />
    <circle cx="15.5" cy="9.5" r="1.3" />
  </Icon>
);
