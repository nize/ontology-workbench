import type { DeprecatedFilter, EntityType, PropertyKind, SearchHighlightField, SearchResponse } from '@acme/shared';
import { Controller, Get, Inject, Query } from '@nestjs/common';

import { SearchService } from './search.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

const ENTITY_TYPES: readonly EntityType[] = ['class', 'property', 'individual'];
const PROPERTY_KINDS: readonly PropertyKind[] = ['object', 'datatype', 'annotation'];
const FIELDS: readonly SearchHighlightField[] = ['label', 'alias', 'comment'];
const DEPRECATED: readonly DeprecatedFilter[] = ['include', 'exclude', 'only'];

type QueryValue = string | string[] | undefined;

/**
 * `GET /search` — full-text search with optional metadata filters.
 *
 * Enumerated filters (`type`, `propertyKind`, `fields`) accept a comma-separated list
 * or repeated params; IRI filters (`definedBy`, `namespace`, `instanceOf`) are repeated
 * params, since IRIs may contain commas. Unknown enum values are ignored.
 */
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Get()
  search(
    @Query('q') query?: string,
    @Query('type') typeParam?: QueryValue,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
    @Query('workspace') workspace?: string,
    @Query('definedBy') definedBy?: QueryValue,
    @Query('namespace') namespace?: QueryValue,
    @Query('propertyKind') propertyKind?: QueryValue,
    @Query('instanceOf') instanceOf?: QueryValue,
    @Query('deprecated') deprecatedParam?: string,
    @Query('fields') fieldsParam?: QueryValue,
    @Query('facets') facetsParam?: string,
    @Query('lang') lang?: string
  ): Promise<SearchResponse> {
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;
    const deprecated = DEPRECATED.find((value) => value === deprecatedParam?.toLowerCase());

    return this.searchService.search(typeof query === 'string' ? query : '', {
      limit,
      offset,
      workspace: targetWorkspace,
      lang,
      types: parseEnumList(typeParam, ENTITY_TYPES),
      definedBy: parseIriList(definedBy),
      namespaces: parseIriList(namespace),
      propertyKinds: parseEnumList(propertyKind, PROPERTY_KINDS),
      instanceOf: parseIriList(instanceOf),
      deprecated,
      fields: parseEnumList(fieldsParam, FIELDS),
      facets: facetsParam === 'true' || facetsParam === '1'
    });
  }
}

function toArray(value: QueryValue | Record<string, string>): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  // Express's query parser turns more than 20 repeated params into an index-keyed object.
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.filter((item): item is string => typeof item === 'string');
}

function parseEnumList<T extends string>(value: QueryValue, allowed: readonly T[]): T[] {
  const result = new Set<T>();
  for (const item of toArray(value).flatMap((entry) => entry.split(','))) {
    const normalized = item.trim().toLowerCase();
    const match = allowed.find((candidate) => candidate === normalized);
    if (match) {
      result.add(match);
    }
  }
  return Array.from(result);
}

function parseIriList(value: QueryValue): string[] {
  return Array.from(new Set(toArray(value).map((item) => item.trim()).filter(Boolean)));
}
