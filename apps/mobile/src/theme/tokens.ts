/** Tokeny z design systemu (ADR 0007); wspólne źródło dla wszystkich ekranów aplikacji. */
export const colors = {
  light: {
    bg: '#F6F6F3',
    surface: '#FFFFFF',
    line: '#E3E3DE',
    ink: '#16181D',
    muted: '#6B6E75',
    accent: '#2B3FF5',
    onAccent: '#FFFFFF',
  },
  dark: {
    bg: '#16181D',
    surface: '#1F2229',
    line: '#2E323B',
    ink: '#F6F6F3',
    muted: '#A3A6AD',
    accent: '#2B3FF5',
    onAccent: '#FFFFFF',
  },
} as const;

export const radius = { field: 16, card: 28, sheet: 32, pill: 999 } as const;
export const space = [0, 4, 8, 12, 16, 20, 24, 32] as const;
