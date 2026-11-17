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
const CURRENCY_IRI = 'http://acme.example/ontology#Currency';
const COUNTRY_IRI = 'http://acme.example/ontology#Country';
const EUR_IRI = 'http://acme.example/ontology#EUR';

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

    it('counts direct individuals per class, ignoring schema subjects', async () => {
      const nodes = await service.getTypeTree(THING_IRI, 1, WORKSPACE_IRI);
      expect(nodes.find((node) => node.iri === CURRENCY_IRI)?.individualCount).toBe(1);
      expect(nodes.find((node) => node.iri === COUNTRY_IRI)?.individualCount).toBe(1);
      // Party has subclasses with individuals but none of its own
      expect(nodes.find((node) => node.iri === PARTY_IRI)?.individualCount).toBe(0);

      const roots = await service.getTypeTree(undefined, 1, WORKSPACE_IRI);
      expect(roots.find((node) => node.iri === THING_IRI)?.individualCount).toBe(0);
    });

    it('lists the individuals of a class with labels', async () => {
      const page = await service.getIndividuals(CURRENCY_IRI, 10, 0, WORKSPACE_IRI);
      expect(page).toEqual({
        class: CURRENCY_IRI,
        total: 1,
        limit: 10,
        offset: 0,
        items: [{ iri: EUR_IRI, label: 'Euro' }]
      });
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

  describe('individual paging', () => {
    const WIDGET_IRI = 'http://acme.example/ontology#Widget';

    beforeEach(async () => {
      const individuals = Array.from({ length: 25 }, (_, i) => {
        const n = String(i).padStart(2, '0');
        return `:w${n} a :Widget , owl:NamedIndividual ; rdfs:label "Widget ${n}"@en .`;
      }).join('\n');
      module = await createTestingModule(`
        @prefix : <http://acme.example/ontology#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

        :Widget a owl:Class ; rdfs:label "Widget"@en .
        :SpecialWidget a owl:Class , :Widget ; rdfs:subClassOf :Widget .
        ${individuals}
      `);
      service = module.get(TypesService);
    });

    it('pages sorted by label and excludes punned classes', async () => {
      const first = await service.getIndividuals(WIDGET_IRI, 10, 0, WORKSPACE_IRI);
      expect(first.total).toBe(25);
      expect(first.items.map((item) => item.label)).toEqual(
        Array.from({ length: 10 }, (_, i) => `Widget ${String(i).padStart(2, '0')}`)
      );

      const last = await service.getIndividuals(WIDGET_IRI, 10, 20, WORKSPACE_IRI);
      expect(last.items.map((item) => item.label)).toEqual([
        'Widget 20', 'Widget 21', 'Widget 22', 'Widget 23', 'Widget 24'
      ]);

      const roots = await service.getTypeTree(undefined, 1, WORKSPACE_IRI);
      expect(roots.find((node) => node.iri === WIDGET_IRI)?.individualCount).toBe(25);
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
          individualCount: 0,
          children: []
        }
      ]);
    });
  });
});
