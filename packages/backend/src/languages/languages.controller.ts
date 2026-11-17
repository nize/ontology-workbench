import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { LanguagesResponse } from '@acme/shared';

import { LanguagesService } from './languages.service.js';

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

/** `GET /languages` — the language tags the UI can offer as a preferred language. */
@Controller('languages')
export class LanguagesController {
  constructor(@Inject(LanguagesService) private readonly languages: LanguagesService) {}

  @Get()
  getLanguages(@Query('workspace') workspace?: string): Promise<LanguagesResponse> {
    return this.languages.getLanguages(workspace ?? DEFAULT_WORKSPACE);
  }
}
