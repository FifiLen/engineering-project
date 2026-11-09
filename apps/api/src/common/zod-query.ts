import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiError } from './api-error.js';

/** Walidacja parametrów żądania schematem Zod; błąd zwraca kod VALIDATION_ERROR z listą pól. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Nieprawidłowe parametry żądania', result.error.issues);
    }
    return result.data;
  }
}
