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
