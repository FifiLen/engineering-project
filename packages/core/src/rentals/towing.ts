import { DomainError } from '../errors.js';

/**
 * Opłata za odholowanie (ADR 0060) przy zdalnym zakończeniu (`END_REMOTELY`). Hulajnoga kwalifikuje się, gdy
 * ostatnia znana pozycja jest poza strefą parkowania (albo w strefie zakazu); brak pozycji też, bo serwis i tak
 * musi hulajnogę odnaleźć. `canPark` liczy `evaluatePosition` dla ostatniej pozycji.
 */
export function qualifiesForTowing(lastPosition: { canPark: boolean } | null): boolean {
  return !lastPosition?.canPark;
}

export interface TowingDecision {
  /** `rentals.towing_fee` w groszach z wersji cennika przejazdu; `null` bez opłaty. */
  towingFee: number | null;
  /** Zgłoszenie `OUT_OF_ZONE` i zadanie `RELOCATION` powstają przy każdym zakończeniu poza strefą, także bez opłaty. */
  relocation: boolean;
}

/**
 * Operator zaznacza „Pobierz opłatę za odholowanie” (domyślnie zaznaczone poza strefą); w strefie parkowania
 * opłaty nie ma, więc zaznaczenie kończy się błędem `TOWING_FEE_NOT_APPLICABLE`.
 */
export function decideTowing(input: {
  outsideParking: boolean;
  collect: boolean;
  /** `out_of_zone_fee` z wersji cennika przejazdu. */
  outOfZoneFee: number;
}): TowingDecision {
  if (!input.outsideParking) {
    if (input.collect) throw new DomainError('TOWING_FEE_NOT_APPLICABLE');
    return { towingFee: null, relocation: false };
  }
  return { towingFee: input.collect && input.outOfZoneFee > 0 ? input.outOfZoneFee : null, relocation: true };
}
