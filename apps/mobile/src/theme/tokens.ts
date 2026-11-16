/** Tokeny z design systemu (ADR 0007); wspólne źródło dla wszystkich ekranów aplikacji. */
export const colors = {
  light: {
    bg: '#F6F6F3',
    surface: '#FFFFFF',
    line: '#E3E3DE',
    ink: '#16181D',
    muted: '#6B6E75',
    accent: '#2B3FF5',
    accentTint: '#EEF0FE',
    onAccent: '#FFFFFF',
    checkbox: '#B9B9B2',
    danger: '#C62F2F',
    dangerTint: '#FBE3E3',
  },
  dark: {
    bg: '#16181D',
    surface: '#1F2229',
    line: '#2E323B',
    ink: '#F6F6F3',
    muted: '#A3A6AD',
    accent: '#2B3FF5',
    accentTint: '#252A4A',
    onAccent: '#FFFFFF',
    checkbox: '#5C606A',
    danger: '#FF7A70',
    dangerTint: '#3A2224',
  },
} as const;

export type Theme = (typeof colors)['light'] | (typeof colors)['dark'];

export const radius = { field: 16, list: 20, card: 28, sheet: 32, pill: 999 } as const;
export const space = [0, 4, 8, 12, 16, 20, 24, 32] as const;
