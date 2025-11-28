import { Module } from '@nestjs/common';

import { DiagramController } from './diagram.controller.js';
import { DiagramService, DIAGRAM_MAX_EDGES } from './diagram.service.js';
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
    }
  ],
  exports: [DiagramService]
})
export class DiagramModule {}
