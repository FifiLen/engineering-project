/**
 * Ikony konturowe z makiet (siatka 24 px, linia 1,9; docs/projekt/tokens.json). Ścieżki są kopią z plików
 * HTML plansz, więc ikona w aplikacji wygląda tak samo jak na makiecie. Ikona jest ozdobą: opis niesie
 * etykieta przycisku albo tekst obok.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const ICONS = {
  locate: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  help: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 16.5h.01" />
    </>
  ),
  person: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  pin: (
    <>
      <Path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z" />
      <Circle cx="12" cy="10" r="2" />
    </>
  ),
  alert: (
    <>
      <Path d="M12 8v5M12 16.5h.01" />
      <Circle cx="12" cy="12" r="9" />
    </>
  ),
  logout: <Path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  back: <Path d="M15 5l-7 7 7 7" />,
  chevron: <Path d="M9 6l6 6-6 6" />,
  cameraOff: (
    <>
      <Path d="M3 3l18 18" />
      <Path d="M9.5 5h5l1.5 2H19a2 2 0 012 2v8" />
      <Path d="M18 19H5a2 2 0 01-2-2V9a2 2 0 012-2h2" />
      <Path d="M10 10.3a3.5 3.5 0 004.7 4.7" />
    </>
  ),
  sliders: (
    <>
      <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <Circle cx="16" cy="7" r="2" />
      <Circle cx="10" cy="17" r="2" />
    </>
  ),
  wifiOff: <Path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M3 3l18 18" />,
  bell: (
    <>
      <Path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2z" />
      <Path d="M10 21h4" />
    </>
  ),
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  document: (
    <>
      <Path d="M7 3h7l4 4v14H7z" />
      <Path d="M14 3v4h4" />
    </>
  ),
  wallet: (
    <>
      <Rect x="3" y="6" width="18" height="13" rx="3" />
      <Path d="M16 12.5h2M3 10h18" />
    </>
  ),
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  lockClosed: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2.5" />
      <Path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  lockOpen: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2.5" />
      <Path d="M8 11V7a4 4 0 017.6-1.8" />
    </>
  ),
  check: <Path d="M5 12l5 5 9-10" />,
  info: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 11v5M12 8h.01" />
    </>
  ),
  warning: (
    <>
      <Path d="M12 4l9 16H3z" />
      <Path d="M12 10v4M12 17h.01" />
    </>
  ),
  exclamation: <Path d="M12 6v8M12 18.5h.01" />,
  trash: <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  battery: (
    <>
      <Rect x="3" y="8" width="16" height="8" rx="2" />
      <Path d="M21 11v2M6 11v2" />
    </>
  ),
  parking: (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="4" />
      <Path d="M10 16V8h3a2.5 2.5 0 010 5h-3" />
    </>
  ),
  torch: (
    <>
      <Path d="M8 3h8l-1 5H9L8 3z" />
      <Path d="M9 8l1 13h4l1-13" />
      <Path d="M12 12v3" />
    </>
  ),
  arrow: <Path d="M5 12h14M13 6l6 6-6 6" />,
  // Iteracja 4 (plansze 22-mobile-strefy, 04-mobile-mapa, 05-mobile-przejazd).
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4" />
    </>
  ),
  searchEmpty: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4M8.5 11h5" />
    </>
  ),
  // Chmura z wykrzyknikiem: błąd usługi wyszukiwania (opis w komentarzu planszy szukaj-brak-wynikow).
  cloudAlert: (
    <>
      <Path d="M7 19h10a4 4 0 00.5-7.97A6 6 0 006.2 9.6 4.75 4.75 0 007 19z" />
      <Path d="M12 11v3.5M12 17h.01" />
    </>
  ),
  walk: (
    <>
      <Circle cx="13" cy="4" r="2" />
      <Path d="M12 8l-1.5 6-2.5 7M10.5 14l3 3 1.5 4M12 8l-3.5 2.5-1 3M12 8l2.5 3 2.5 1" />
    </>
  ),
  map: (
    <>
      <Path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" />
      <Path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  noEntry: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  gauge: (
    <>
      <Path d="M4.5 17a8.5 8.5 0 1115 0" />
      <Path d="M12 13l4-4" />
    </>
  ),
  scooter: (
    <>
      <Circle cx="5.5" cy="18" r="2.5" />
      <Circle cx="18.5" cy="18" r="2.5" />
      <Path d="M8 18h8M16.5 16.5L14 4h3.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  color,
  size = 20,
  strokeWidth = 1.9,
}: {
  name: IconName;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </Svg>
  );
}
