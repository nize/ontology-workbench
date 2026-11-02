import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Node is PID 1 in the container image, so SIGTERM is ignored unless handled.
  app.enableShutdownHooks();
  await app.listen(4000);
}
bootstrap();