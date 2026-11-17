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
<urn:test:module/> a <http://www.w3.org/2002/07/owl#Ontology> ;
  <http://www.w3.org/2000/01/rdf-schema#label> "Test Module"@en .
<urn:test:module/LegacyAccount> a <http://www.w3.org/2002/07/owl#Class> ;
  <http://www.w3.org/2000/01/rdf-schema#label> "Legacy Account"@en ;
  <http://www.w3.org/2000/01/rdf-schema#isDefinedBy> <urn:test:module/> ;
  <http://www.w3.org/2002/07/owl#deprecated> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .
<urn:test:module/hasAccountNote> a <http://www.w3.org/2002/07/owl#AnnotationProperty> ;
  <http://www.w3.org/2000/01/rdf-schema#label> "account note"@en ;
  <http://www.w3.org/2000/01/rdf-schema#isDefinedBy> <urn:test:module/> .
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

  describe('metadata filters', () => {
    const ACME = 'http://acme.example/ontology#';

    it('keeps the empty-query no-op when no filters or facets are requested', async () => {
      const results = await service.search('', { workspace: WORKSPACE_IRI });
      expect(results.total).toBe(0);
      expect(results.facets).toBeUndefined();
    });

    it('filters by several entity types at once and by property kind', async () => {
      const both = await service.search('account', {
        workspace: WORKSPACE_IRI,
        types: ['class', 'property'],
        limit: 100
      });
      const types = new Set(both.hits.map((hit) => hit.type));
      expect(types).toEqual(new Set(['class', 'property']));

      const datatype = await service.search('account', {
        workspace: WORKSPACE_IRI,
        propertyKinds: ['datatype'],
        limit: 100
      });
      expect(datatype.hits.map((hit) => hit.iri)).toEqual([`${ACME}accountNumber`]);
      expect(datatype.hits[0]?.propertyKind).toBe('datatype');
    });

    it('filters by defining ontology and deprecation, and reports them on hits', async () => {
      const defined = await service.search('account', {
        workspace: WORKSPACE_IRI,
        definedBy: ['urn:test:module/'],
        limit: 100
      });
      expect(defined.hits.map((hit) => hit.label).sort()).toEqual(['Legacy Account', 'account note']);

      const withoutDeprecated = await service.search('account', {
        workspace: WORKSPACE_IRI,
        deprecated: 'exclude',
        limit: 100
      });
      expect(withoutDeprecated.hits.some((hit) => hit.label === 'Legacy Account')).toBe(false);

      const onlyDeprecated = await service.search('account', {
        workspace: WORKSPACE_IRI,
        deprecated: 'only',
        limit: 100
      });
      expect(onlyDeprecated.hits.map((hit) => hit.label)).toEqual(['Legacy Account']);
      expect(onlyDeprecated.hits[0]?.deprecated).toBe(true);
    });

    it('filters individuals by class and entities by namespace', async () => {
      const people = await service.search('', {
        workspace: WORKSPACE_IRI,
        instanceOf: [`${ACME}Person`]
      });
      expect(people.hits.map((hit) => hit.iri)).toEqual([`${ACME}alice`]);

      const testNamespace = await service.search('', {
        workspace: WORKSPACE_IRI,
        namespaces: ['urn:test:module/'],
        limit: 100
      });
      expect(testNamespace.hits.map((hit) => hit.label).sort()).toEqual(['Legacy Account', 'Test Module', 'account note']);
    });

    it('restricts matching to the chosen text fields', async () => {
      const labelsOnly = await service.search('party', {
        workspace: WORKSPACE_IRI,
        fields: ['label'],
        limit: 100
      });
      const labels = labelsOnly.hits.map((hit) => hit.label);
      expect(labels).toContain('Party');
      expect(labels).not.toContain('Agreement');
      expect(labels).not.toContain('Contract');
    });

    it('returns facet counts that ignore the facet\'s own selection', async () => {
      const results = await service.search('account', {
        workspace: WORKSPACE_IRI,
        types: ['class'],
        facets: true,
        limit: 100
      });
      expect(results.hits.every((hit) => hit.type === 'class')).toBe(true);

      const typeFacet = results.facets?.type ?? [];
      const propertyCount = typeFacet.find((value) => value.value === 'property')?.count ?? 0;
      expect(propertyCount).toBeGreaterThan(0);

      // Other facets are narrowed by the type selection: only the class is deprecated.
      expect(results.facets?.deprecated.find((value) => value.value === 'only')?.count).toBe(1);
      const module = results.facets?.definedBy.find((value) => value.value === 'urn:test:module/');
      expect(module).toMatchObject({ label: 'Test Module', count: 1 });
    });

    it('browses all entities by label when only facets are requested', async () => {
      const results = await service.search('', { workspace: WORKSPACE_IRI, facets: true, limit: 5 });
      expect(results.total).toBeGreaterThan(5);
      expect(results.hits).toHaveLength(5);
      expect(results.facets?.namespace.some((value) => value.value === ACME)).toBe(true);
    });

    it('keeps a selected facet value listed even when it matches nothing', async () => {
      const results = await service.search('zzzz-nothing', {
        workspace: WORKSPACE_IRI,
        instanceOf: [`${ACME}Person`],
        facets: true
      });
      expect(results.total).toBe(0);
      expect(results.facets?.instanceOf).toContainEqual({ value: `${ACME}Person`, label: 'Person', count: 0 });
    });
  });
});
