import { Module } from '@nestjs/common';
import { EntitiesModule } from './entities/entities.module.js';
import { GraphStoreModule } from './sparql/graphStore.module.js';
import { SearchModule } from './search/search.module.js';
import { TypesModule } from './types/types.module.js';
import { DiagramModule } from './diagram/diagram.module.js';

@Module({
  imports: [
    GraphStoreModule.forRoot({ isGlobal: true }),
    EntitiesModule,
    SearchModule,
    TypesModule,
    DiagramModule,
  ],
})
export class AppModule {}