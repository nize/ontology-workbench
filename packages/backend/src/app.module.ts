import { Module } from '@nestjs/common';
import { EntitiesModule } from './entities/entities.module.js';
import { GraphStoreModule } from './sparql/graphStore.module.js';
import { TypesModule } from './types/types.module.js';

@Module({
  imports: [
    GraphStoreModule.forRoot({ isGlobal: true }),
    EntitiesModule,
    TypesModule,
  ],
})
export class AppModule {}