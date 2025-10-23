import { BadRequestException, Controller, Get, Query } from '@nestjs/common';

import { TypesService, type TypeTreeNode } from './types.service.js';

@Controller('types')
export class TypesController {
  constructor(private readonly types: TypesService) {}

  @Get('tree')
  async getTree(
    @Query('root') rootParam?: string,
    @Query('depth') depthParam?: string,
    @Query('workspace') workspace?: string
  ): Promise<TypeTreeNode[]> {
    if (!workspace) {
      throw new BadRequestException('workspace query parameter is required');
    }

    let root: string | undefined;
    if (rootParam) {
      try {
        root = decodeURIComponent(rootParam);
      } catch {
        throw new BadRequestException('Invalid root parameter');
      }
    }

    const depth = parseDepth(depthParam);

    return this.types.getTree({ root, depth, workspace });
  }
}

function parseDepth(depthParam?: string): number {
  if (depthParam === undefined) {
    return 1;
  }
  const trimmed = depthParam.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException('Depth must be a non-negative integer');
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException('Depth must be a non-negative integer');
  }
  return parsed;
}
