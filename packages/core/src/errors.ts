/**
 * Naruszenie reguły domeny. `code` trafia do odpowiedzi API jako kod maszynowy (arc42 §8.8),
 * a tekst dla użytkownika pochodzi z plików tłumaczeń klienta (ADR 0027).
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
