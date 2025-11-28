import { BadRequestException, Controller, Get, Query } from '@nestjs/common';

import { DiagramService } from './diagram.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

@Controller('diagram')
export class DiagramController {
  constructor(private readonly diagramService: DiagramService) {}

  @Get()
  async getDiagram(
    @Query('center') centerParam?: string,
    @Query('radius') radiusParam?: string,
    @Query('workspace') workspace?: string
  ) {
    if (!centerParam) {
      throw new BadRequestException('Missing center parameter');
    }
    const center = decodeURIComponent(centerParam);
    const radius = radiusParam ? Number.parseInt(radiusParam, 10) : 1;
    const targetWorkspace = workspace ?? DEFAULT_WORKSPACE;

    return this.diagramService.getDiagram(center, radius, targetWorkspace);
  }
}
