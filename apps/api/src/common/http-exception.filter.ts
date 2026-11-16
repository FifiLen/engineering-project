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
      const status = exception.code === 'FORBIDDEN' ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT;
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
