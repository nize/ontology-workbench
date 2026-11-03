import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import { EntitiesService } from './entities.service.js';

@Controller('entities')
export class EntitiesController {
  constructor(@Inject(EntitiesService) private readonly entities: EntitiesService) {}

  // The IRI is an opaque identifier. Express has already decoded the path
  // segment once, which is exactly the encoding the client applied; decoding
  // again would turn a literal %2F in the IRI into "/".
  @Get(':iri')
  async getEntity(@Param('iri') iri: string, @Query('workspace') workspace?: string) {
    const targetWorkspace = workspace ?? process.env.DEFAULT_WORKSPACE;
    return this.entities.getEntityDetails(iri, targetWorkspace);
  }
}
