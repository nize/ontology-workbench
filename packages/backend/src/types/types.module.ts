import { Module } from '@nestjs/common';

import { TypesController } from './types.controller.js';
import { TypesService } from './types.service.js';

@Module({
  imports: [],
  controllers: [TypesController],
  providers: [TypesService],
  exports: [TypesService]
})
export class TypesModule {}
