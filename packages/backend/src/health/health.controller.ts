import { Controller, Get } from '@nestjs/common';

// Liveness only: answers as long as the process serves HTTP. It deliberately
// does not query the graph store, so a slow or restarting GraphDB does not get
// the backend container killed by its health check.
@Controller('healthz')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', version: process.env.APP_VERSION ?? 'dev' };
  }
}
