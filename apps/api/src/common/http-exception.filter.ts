import { DomainError } from '@hulajnogi/core';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiErrorBody } from './api-error.js';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

/** Kody domeny z innym statusem niż 409 (naruszenie reguły albo konflikt stanu). */
const DOMAIN_STATUS: Record<string, HttpStatus> = {
  FORBIDDEN: HttpStatus.FORBIDDEN,
  PERMISSION_NOT_DECLARED: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  // Uwierzytelnianie (ADR 0035): brak sesji i błędne dane logowania.
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  TOTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  OTP_ATTEMPTS_EXCEEDED: HttpStatus.UNAUTHORIZED,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  ACCOUNT_LOCKED: HttpStatus.TOO_MANY_REQUESTS,
  INVITATION_INVALID: HttpStatus.NOT_FOUND,
  INVITATION_EXPIRED: HttpStatus.GONE,
  // Dane wejściowe, które przeszły schemat, ale nie spełniają reguły z core.
  INVALID_PHONE: HttpStatus.BAD_REQUEST,
  WEAK_PASSWORD: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  AGE_NOT_CONFIRMED: HttpStatus.BAD_REQUEST,
  UNKNOWN_PERMISSION: HttpStatus.BAD_REQUEST,
  // Wypożyczenie (ADR 0036): reguła strefy i warunki klienta to 422, konflikty stanu zostają przy 409.
  OUTSIDE_PARKING: HttpStatus.UNPROCESSABLE_ENTITY,
  CONSENT_REQUIRED: HttpStatus.FORBIDDEN,
  ACCOUNT_BLOCKED: HttpStatus.FORBIDDEN,
  RING_NOT_ALLOWED: HttpStatus.FORBIDDEN,
  TARIFF_MISSING: HttpStatus.SERVICE_UNAVAILABLE,
  // Strefy (ADR 0047): reguły geometrii to 422, użycie strefy i jej typ to konflikty stanu (409).
  ZONE_INVALID_GEOMETRY: HttpStatus.UNPROCESSABLE_ENTITY,
  ZONE_OUTSIDE_SERVICE_AREA: HttpStatus.UNPROCESSABLE_ENTITY,
  ZONE_OVERLAP: HttpStatus.UNPROCESSABLE_ENTITY,
  // Usługi map (ADR 0045): wyszukiwanie bez Photon.
  PLACES_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  // Płatności (ADR 0049–0054): warunki płatności klienta to 422, odmowa operatora 402, konflikty stanu 409.
  INSUFFICIENT_BALANCE: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_OVERDUE: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_METHOD_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  TOPUP_AMOUNT_INVALID: HttpStatus.BAD_REQUEST,
  TARIFF_INVALID: HttpStatus.BAD_REQUEST,
  REFUND_EXCEEDS_PAYMENT: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_FAILED: HttpStatus.PAYMENT_REQUIRED,
  PAYMENT_PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  WEBHOOK_SIGNATURE_INVALID: HttpStatus.BAD_REQUEST,
  NOTHING_TO_PAY_OUT: HttpStatus.UNPROCESSABLE_ENTITY,
  // Przejazd bez łączności i odholowanie (ADR 0056, ADR 0060): reguły pozycji i opłaty to 422.
  POSITION_STALE: HttpStatus.UNPROCESSABLE_ENTITY,
  TOWING_FEE_NOT_APPLICABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  // Pliki (ADR 0057): rozmiar i typ wysyłki, podpis adresu odczytu, obiekt usunięty po retencji.
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  FILE_TYPE_NOT_ALLOWED: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  FILE_SIGNATURE_INVALID: HttpStatus.FORBIDDEN,
  FILE_URL_EXPIRED: HttpStatus.FORBIDDEN,
  FILE_DELETED: HttpStatus.GONE,
  FILE_PURPOSE_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  // Zgłoszenia i serwis (ADR 0055): dane zgłoszenia to 400, reguły treści i magazynu 422, konflikty stanu 409.
  TICKET_CATEGORIES_REQUIRED: HttpStatus.BAD_REQUEST,
  TICKET_DESCRIPTION_REQUIRED: HttpStatus.BAD_REQUEST,
  TICKET_TOO_MANY_PHOTOS: HttpStatus.BAD_REQUEST,
  TICKET_CATEGORY_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  TICKET_RENTAL_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  TICKET_REPLY_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  TICKET_REPLY_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  TICKET_RENTAL_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  PART_QUANTITY_INVALID: HttpStatus.BAD_REQUEST,
  PART_OUT_OF_STOCK: HttpStatus.UNPROCESSABLE_ENTITY,
  PART_RETURN_EXCEEDS: HttpStatus.UNPROCESSABLE_ENTITY,
  PART_INACTIVE: HttpStatus.UNPROCESSABLE_ENTITY,
  // Szablony powiadomień (ADR 0058): błąd treści z wierszem i znakiem w `details` to 422.
  TEMPLATE_SYNTAX_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_UNKNOWN_PARAM: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_PARAM_TYPE: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_UNKNOWN_OPTION: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_MISSING_PARAM: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_TOO_LONG: HttpStatus.UNPROCESSABLE_ENTITY,
  TEMPLATE_MISSING: HttpStatus.SERVICE_UNAVAILABLE,
  // Symulator (ADR 0059): broker nie przyjął polecenia.
  SIMULATOR_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const body: ApiErrorBody =
        typeof response === 'object' && response !== null && 'code' in response
          ? (response as ApiErrorBody)
          : { code: DEFAULT_CODES[status] ?? 'ERROR', message: exception.message };
      void reply.status(status).send(body);
      return;
    }
    if (exception instanceof DomainError) {
      // Naruszenie reguły domeny z packages/core; klient tłumaczy komunikat po kodzie (ADR 0027).
      const status = DOMAIN_STATUS[exception.code] ?? HttpStatus.CONFLICT;
      const retryAfter = exception.details?.retryAfterSeconds;
      if (typeof retryAfter === 'number') void reply.header('retry-after', String(retryAfter));
      void reply
        .status(status)
        .send({ code: exception.code, message: exception.message, details: exception.details } satisfies ApiErrorBody);
      return;
    }
    this.logger.error(exception);
    void reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send({ code: 'INTERNAL_ERROR', message: 'Wystąpił nieoczekiwany błąd' } satisfies ApiErrorBody);
  }
}
