/** Tokeny z design systemu (ADR 0007, docs/projekt/tokens.json); wspólne źródło dla wszystkich ekranów aplikacji. */
export const colors = {
  light: {
    bg: '#F6F6F3',
    surface: '#FFFFFF',
    line: '#E3E3DE',
    ink: '#16181D',
    muted: '#6B6E75',
    accent: '#2B3FF5',
    accentTint: '#EEF0FE',
    /** Kolor akcji na mapie i w znacznikach (w trybie ciemnym jaśniejszy). */
    accentMap: '#2B3FF5',
    onAccent: '#FFFFFF',
    checkbox: '#B9B9B2',
    danger: '#C62F2F',
    dangerTint: '#FBE3E3',
    warning: '#8F5500',
    warningTint: '#FFF1DB',
    /** Przycisk grafitowy (Zakończ, Anuluj rezerwację, Gotowe). */
    dark: '#16181D',
    onDark: '#FFFFFF',
    readonly: '#EDEDE9',
    map: '#EFEFEC',
    glass: 'rgba(246,246,243,0.84)',
    glassBorder: 'rgba(255,255,255,0.7)',
    scrim: 'rgba(22,24,29,0.32)',
    camera: '#1B1C20',
  },
  dark: {
    bg: '#16181D',
    surface: '#1F2229',
    line: '#2E323B',
    ink: '#F6F6F3',
    muted: '#A3A6AD',
    accent: '#2B3FF5',
    accentTint: '#252A4A',
    accentMap: '#7A88FF',
    onAccent: '#FFFFFF',
    checkbox: '#5C606A',
    danger: '#FF7A70',
    dangerTint: '#3A2224',
    warning: '#F2B455',
    // Brak w tokens.json: odcień ostrzeżenia na ciemnym tle dobrany jak dangerTint.
    warningTint: '#3A2F1F',
    dark: '#F6F6F3',
    onDark: '#16181D',
    readonly: '#2A2E36',
    map: '#121418',
    glass: 'rgba(31,34,41,0.80)',
    glassBorder: 'rgba(255,255,255,0.08)',
    scrim: 'rgba(0,0,0,0.5)',
    camera: '#1B1C20',
  },
} as const;

export type Theme = { [K in keyof (typeof colors)['light']]: string } & { scheme: 'light' | 'dark' };

export const radius = { field: 16, list: 20, card: 28, sheet: 32, pill: 999 } as const;
export const space = [0, 4, 8, 12, 16, 20, 24, 32] as const;
