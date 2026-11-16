import { parseListQuery, type ListQuery, type ResourceDefinition } from '@hulajnogi/shared';
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error.js';

/** Parametry listy według definicji zasobu (ADR 0031); nieznany filtr lub sortowanie to VALIDATION_ERROR. */
export class ListQueryPipe implements PipeTransform<Record<string, string | string[]>, ListQuery> {
  constructor(private readonly resource: ResourceDefinition) {}

  transform(value: Record<string, string | string[]>): ListQuery {
    const result = parseListQuery(this.resource, value);
    if (!result.ok) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Nieprawidłowe parametry listy', result.issues);
    }
    return result.query;
  }
}
