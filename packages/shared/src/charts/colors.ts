/**
 * Kolory wykresów (ADR 0072), kopia sekcji `chart` z `docs/projekt/tokens.json` (zgodność pilnuje test). Słupki
 * w grafitowej szarości (kontrast 5,1:1 na białym), poprzedni okres w betonie, kobalt tylko dla bieżącej albo
 * zaznaczonej wartości, znacznik średniej grafitowy (co najmniej 3:1), mapa ciepła w pięciu stopniach od betonu do
 * grafitu, stany hulajnogi jak na mapie floty (`fleet-format.tsx`). Zmiana wobec poprzedniego okresu to strzałka
 * w kolorze tekstu, bez zieleni i czerwieni.
 */
export const CHART_COLORS = {
  bar: '#6B6E75',
  previous: '#E3E3DE',
  current: '#2B3FF5',
  average: '#16181D',
  axis: '#E3E3DE',
  text: '#6B6E75',
  ink: '#16181D',
  surface: '#FFFFFF',
  onDark: '#FFFFFF',
  heatmap: ['#EDEDE9', '#C9CAC4', '#9A9CA1', '#5E6168', '#16181D'],
  status: {
    AVAILABLE: '#16181D',
    IN_RIDE: '#2B3FF5',
    RESERVED: '#AEB6FB',
    SERVICE: '#C62F2F',
    OFFLINE: '#B9B9B2',
    LOW_BATTERY: '#8F5500',
    RETIRED: '#E3E3DE',
    UNTRACKED: '#EDEDE9',
  },
} as const;

export type ChartStatusColor = keyof typeof CHART_COLORS.status;

/** Kolor tekstu na komórce mapy ciepła (dwa najciemniejsze stopnie mają biały tekst). */
export const heatmapTextColor = (step: number): string => (step >= 3 ? CHART_COLORS.onDark : CHART_COLORS.ink);
