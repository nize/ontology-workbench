import { EntityType, type SearchResponse } from '@acme/shared';
import { Controller, Get, Query } from '@nestjs/common';

import { SearchService } from './search.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @Query('q') query?: string,
    @Query('type') typeParam?: string,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
    @Query('workspace') workspace?: string
  ): Promise<SearchResponse> {
    const type = this.parseType(typeParam);
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;

    return this.searchService.search(query ?? '', {
      limit,
      offset,
      type,
      workspace: targetWorkspace
    });
  }

  private parseType(input?: string): EntityType | undefined {
    if (!input) {
      return undefined;
    }
    const normalized = input.toLowerCase();
    return normalized === 'class' || normalized === 'property' || normalized === 'individual'
      ? (normalized as EntityType)
      : undefined;
  }
}
