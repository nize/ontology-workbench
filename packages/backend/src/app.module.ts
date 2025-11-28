import { Module } from '@nestjs/common';
import { EntitiesModule } from './entities/entities.module.js';
import { GraphStoreModule } from './sparql/graphStore.module.js';

@Module({
  imports: [
    GraphStoreModule.forRoot({ isGlobal: true }),
    EntitiesModule,
  ],
})
export class AppModule {}