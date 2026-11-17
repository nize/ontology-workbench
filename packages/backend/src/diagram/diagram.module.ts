import { Module } from '@nestjs/common';

import { DiagramController } from './diagram.controller.js';
import { DiagramService, DIAGRAM_MAX_EDGES, DIAGRAM_MAX_INDIVIDUALS_PER_CLASS } from './diagram.service.js';
import { EntitiesService } from '../entities/entities.service.js';

@Module({
  imports: [],
  controllers: [DiagramController],
  providers: [
    DiagramService,
    EntitiesService,
    {
      provide: DIAGRAM_MAX_EDGES,
      useValue: 50
    },
    {
      provide: DIAGRAM_MAX_INDIVIDUALS_PER_CLASS,
      useValue: 10
    }
  ],
  exports: [DiagramService]
})
export class DiagramModule {}
