import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';

import { TypesService } from './types.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

@Controller('types')
export class TypesController {
  constructor(@Inject(TypesService) private readonly typesService: TypesService) {}

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

  // Individuals whose direct rdf:type is `class`, paged. `class` is an opaque
  // IRI that Express has already decoded once; it must not be decoded again.
  @Get('individuals')
  async getIndividuals(
    @Query('class') classIri?: string,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
    @Query('workspace') workspace?: string
  ) {
    if (!classIri) {
      throw new BadRequestException('Missing class parameter');
    }
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;

    return this.typesService.getIndividuals(classIri, limit, offset, targetWorkspace);
  }
}
