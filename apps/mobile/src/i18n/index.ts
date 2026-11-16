import { createTranslator } from '@hulajnogi/shared';
import messages from './pl.json';

/**
 * Etykiety aplikacji z pliku tłumaczeń (ADR 0027, ADR 0032); w komponentach tylko klucze.
 * Treści merytoryczne (np. hasło na ekranie startowym) przejdą do bloków treści z API w iteracji 7.
 */
export const t = createTranslator(messages, 'pl');
