import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n.js';

const messages = {
  fleet: {
    title: 'Flota',
    count: '{count, plural, one {# hulajnoga} few {# hulajnogi} many {# hulajnóg} other {# hulajnogi}}',
    status: { AVAILABLE: 'Dostępna' },
  },
};

describe('tłumacz etykiet', () => {
  const t = createTranslator(messages);

  it('zwraca etykietę po kluczu', () => {
    expect(t('fleet.title')).toBe('Flota');
  });

  it('odmienia liczebniki według reguł języka polskiego', () => {
    expect(t('fleet.count', { count: 1 })).toBe('1 hulajnoga');
    expect(t('fleet.count', { count: 3 })).toBe('3 hulajnogi');
    expect(t('fleet.count', { count: 240 })).toBe('240 hulajnóg');
  });

  it('klucze dynamiczne: brak etykiety zwraca klucz', () => {
    expect(t.dynamic('fleet.status.AVAILABLE')).toBe('Dostępna');
    expect(t.dynamic('fleet.status.NOPE')).toBe('fleet.status.NOPE');
    expect(t.has('fleet.status.NOPE')).toBe(false);
  });
});
