import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { SearchModule } from '../search.module.js';
import { SearchService } from '../search.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/test';

let ontologyTurtle: string;

describe('SearchService', () => {
  beforeAll(async () => {
    ontologyTurtle = await readFile(new URL('../../../fixtures/acme-sample.ttl', import.meta.url), 'utf-8');
  });

  let testingModule: TestingModule;
  let service: SearchService;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        GraphStoreModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => {
            const repository = new OxigraphLocalRepository();
            repository.loadTurtle(ontologyTurtle, WORKSPACE_IRI);
            return repository;
          }
        }),
        SearchModule
      ]
    }).compile();

    service = testingModule.get(SearchService);
  });

  afterEach(async () => {
    if (testingModule) {
      await testingModule.close();
    }
  });

  it('rebuilds the search index from workspace data', async () => {
    const count = await service.rebuildIndex(WORKSPACE_IRI);
    expect(count).toBeGreaterThan(0);

    const results = await service.search('Account', { workspace: WORKSPACE_IRI });
    expect(results.total).toBeGreaterThan(0);
    expect(results.hits[0]?.label).toBe('Account');
  });

  it('supports prefix and fuzzy queries with highlighting', async () => {
    await service.rebuildIndex(WORKSPACE_IRI);

    const prefixResults = await service.search('Acc', { workspace: WORKSPACE_IRI });
    const accountHit = prefixResults.hits.find((hit) => hit.label === 'Account');
    expect(accountHit?.highlights[0]?.snippet).toContain('<mark>Acc</mark>');

    const fuzzyResults = await service.search('Lon', { workspace: WORKSPACE_IRI });
    const loanHit = fuzzyResults.hits.find((hit) => hit.label === 'Loan');
    expect(loanHit).toBeDefined();
  });
});
