import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Jeden format błędów API (arc42 §8.8): kod maszynowy, komunikat i szczegóły.
 * Klienci reagują na `code`, a nie na treść komunikatu.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details } satisfies ApiErrorBody, status);
  }
}
