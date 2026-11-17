import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { SearchModule } from '../search.module.js';
import { SearchService } from '../search.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/test';

// Classes whose descriptions mention "party" and whose labels sort before "Party",
// so a ranking that ignores which field matched would put them first.
const SEARCH_EXTRAS = `
<urn:test:Agreement> a <http://www.w3.org/2002/07/owl#Class> ;
  <http://www.w3.org/2000/01/rdf-schema#label> "Agreement"@en ;
  <http://www.w3.org/2004/02/skos/core#definition> "Party obligations agreed between counterparties."@en .
<urn:test:Contract> a <http://www.w3.org/2002/07/owl#Class> ;
  <http://www.w3.org/2000/01/rdf-schema#label> "Contract"@en ;
  <http://www.w3.org/2000/01/rdf-schema#comment> "party"@en .
`;

let ontologyTurtle: string;

describe('SearchService', () => {
  beforeAll(async () => {
    ontologyTurtle =
      (await readFile(new URL('../../../fixtures/acme-sample.ttl', import.meta.url), 'utf-8')) + SEARCH_EXTRAS;
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

  it('ranks an exact label match above entities that only mention the term in their description', async () => {
    await service.rebuildIndex(WORKSPACE_IRI);

    const results = await service.search('party', { workspace: WORKSPACE_IRI });
    expect(results.hits[0]?.label).toBe('Party');
    expect(results.hits[0]?.highlights[0]?.field).toBe('label');
    const labels = results.hits.map((hit) => hit.label);
    expect(labels.indexOf('Agreement')).toBeGreaterThan(0);
    expect(labels.indexOf('Contract')).toBeGreaterThan(0);
  });
});
