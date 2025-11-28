import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { GraphStoreService } from '../../sparql/graphStore.service.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';
import { TypesModule } from '../types.module.js';
import { TypesService } from '../types.service.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/test';
const THING_IRI = 'http://acme.example/ontology#Thing';
const ACCOUNT_IRI = 'http://acme.example/ontology#Account';
const PARTY_IRI = 'http://acme.example/ontology#Party';
const CROSS_LISTED_IRI = 'http://acme.example/ontology#CrossListedAccount';

let acmeOntology: string;

async function createTestingModule(extraTurtle?: string): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      GraphStoreModule.forRootAsync({
        isGlobal: true,
        useFactory: async () => {
          const repository = new OxigraphLocalRepository();
          repository.loadTurtle(acmeOntology, WORKSPACE_IRI);
          if (extraTurtle) {
            repository.loadTurtle(extraTurtle, WORKSPACE_IRI);
          }
          return repository;
        }
      }),
      TypesModule
    ]
  }).compile();
}

describe('TypesService', () => {
  beforeAll(async () => {
    acmeOntology = await readFile(new URL('../../../fixtures/acme-sample.ttl', import.meta.url), 'utf-8');
  });

  let module: TestingModule;
  let service: TypesService;
  let graphStore: GraphStoreService;

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('with base ontology', () => {
    beforeEach(async () => {
      module = await createTestingModule();
      service = module.get(TypesService);
      graphStore = module.get(GraphStoreService);
    });

    it('returns sorted children at requested depth', async () => {
      const nodes = await service.getTypeTree(THING_IRI, 1, WORKSPACE_IRI);

      const labels = nodes.map((node) => node.label);
      expect(labels).toEqual(['Account', 'Country', 'Currency', 'Party']);

      const account = nodes.find((node) => node.iri === ACCOUNT_IRI);
      expect(account?.hasChildren).toBe(true);
      expect(account?.childCount).toBeGreaterThan(0);
      expect(account?.children).toEqual([]);
    });

    it('caches the materialized tree per workspace', async () => {
      const selectSpy = vi.spyOn(graphStore, 'select');

      await service.getTypeTree(undefined, 2, WORKSPACE_IRI);
      const firstLoadCalls = selectSpy.mock.calls.length;
      await service.getTypeTree(THING_IRI, 1, WORKSPACE_IRI);
      expect(selectSpy).toHaveBeenCalledTimes(firstLoadCalls);

      service.invalidate(WORKSPACE_IRI);
      await service.getTypeTree(THING_IRI, 1, WORKSPACE_IRI);
      expect(selectSpy).toHaveBeenCalledTimes(firstLoadCalls * 2);
    });
  });

  describe('primary-parent selection', () => {
    beforeEach(async () => {
      module = await createTestingModule(`
        @prefix : <http://acme.example/ontology#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

        :CrossListedAccount a owl:Class ;
          rdfs:label "Cross Listed Account"@en ;
          rdfs:subClassOf :Account , :Party .
      `);
      service = module.get(TypesService);
    });

    it('duplicates multi-parent nodes while keeping a deterministic primaryParent', async () => {
      const accountChildren = await service.getTypeTree(ACCOUNT_IRI, 2, WORKSPACE_IRI);
      const crossListed = accountChildren.find((node) => node.iri === CROSS_LISTED_IRI);
      expect(crossListed?.primaryParent).toBe(ACCOUNT_IRI);

      const partyChildren = await service.getTypeTree(PARTY_IRI, 2, WORKSPACE_IRI);
      const underParty = partyChildren.find((node) => node.iri === CROSS_LISTED_IRI);
      expect(underParty?.primaryParent).toBe(ACCOUNT_IRI);
      expect(underParty?.children.length).toBe(0);
      expect(underParty?.hasChildren).toBe(false);
    });
  });

  describe('with a minimal tree', () => {
    const SIMPLE_ROOT = 'http://acme.example/ontology#SimpleRoot';
    const SIMPLE_CHILD = 'http://acme.example/ontology#SimpleChild';

    beforeEach(async () => {
      module = await createTestingModule(`
        @prefix : <http://acme.example/ontology#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

        :SimpleRoot a owl:Class ;
          rdfs:label "Simple Root"@en .

        :SimpleChild a owl:Class ;
          rdfs:label "Simple Child"@en ;
          rdfs:subClassOf :SimpleRoot .
      `);
      service = module.get(TypesService);
    });

    it('returns the full child list for a shallow tree', async () => {
      const tree = await service.getTypeTree(SIMPLE_ROOT, 2, WORKSPACE_IRI);

      expect(tree).toEqual([
        {
          iri: SIMPLE_CHILD,
          label: 'Simple Child',
          primaryParent: SIMPLE_ROOT,
          childCount: 0,
          hasChildren: false,
          children: []
        }
      ]);
    });
  });
});
