import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';

import { DiagramService } from './diagram.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

@Controller('diagram')
export class DiagramController {
  constructor(@Inject(DiagramService) private readonly diagramService: DiagramService) {}

  // `center` is an opaque IRI that Express has already decoded once; see
  // EntitiesController for why it must not be decoded again.
  @Get()
  async getDiagram(
    @Query('center') center?: string,
    @Query('radius') radiusParam?: string,
    @Query('workspace') workspace?: string
  ) {
    if (!center) {
      throw new BadRequestException('Missing center parameter');
    }
    const radius = radiusParam ? Number.parseInt(radiusParam, 10) : 1;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;

    return this.diagramService.getDiagram(center, radius, targetWorkspace);
  }
}
