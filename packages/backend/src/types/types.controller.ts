import { Controller, Get, Query } from '@nestjs/common';

import { TypesService } from './types.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

@Controller('types')
export class TypesController {
  constructor(private readonly typesService: TypesService) {}

  @Get('tree')
  async getTypeTree(
    @Query('root') rootParam?: string,
    @Query('depth') depthParam?: string,
    @Query('workspace') workspace?: string
  ) {
    const decodedRoot = rootParam;
    const depth = depthParam ? Number.parseInt(depthParam, 10) : 1;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;

    return this.typesService.getTypeTree(decodedRoot, depth, targetWorkspace);
  }
}
