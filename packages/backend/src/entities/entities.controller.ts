import { Controller, Get, Param, Query } from '@nestjs/common';

import { EntitiesService } from './entities.service.js';

@Controller('entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get(':iri')
  async getEntity(@Param('iri') iriParam: string, @Query('workspace') workspace?: string) {
    const iri = decodeURIComponent(iriParam);
    return this.entities.getEntityDetails(iri, workspace);
  }
}
