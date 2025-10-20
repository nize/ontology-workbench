import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { EntitiesModule } from '../entities.module.js';
import { EntitiesService, type Restriction } from '../entities.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { GraphStoreService } from '../../sparql/graphStore.service.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/test';
const LOAN_IRI = 'http://acme.example/ontology#Loan';
const HAS_BORROWER_IRI = 'http://acme.example/ontology#hasBorrower';
const HAS_CURRENCY_IRI = 'http://acme.example/ontology#hasCurrency';
const HAS_GUARANTOR_IRI = 'http://acme.example/ontology#hasGuarantor';
const HAS_BORROWER_RANGE_IRI = 'http://acme.example/ontology#Person';
const HAS_CURRENCY_RANGE_IRI = 'http://acme.example/ontology#Currency';
const HAS_GUARANTOR_RANGE_IRI = 'http://acme.example/ontology#Organization';
const ACCOUNT_IRI = 'http://acme.example/ontology#Account';
const HAS_BORROWER_PROP_IRI = 'http://acme.example/ontology#hasBorrower';
const LOAN123_IRI = 'http://acme.example/ontology#loan123';
const PERSON_IRI = 'http://acme.example/ontology#Person';
const ACCOUNT_NUMBER_IRI = 'http://acme.example/ontology#accountNumber';

let acmeOntology: string;

describe('EntitiesService', () => {
  beforeAll(async () => {
    acmeOntology = await readFile(new URL('../../../fixtures/acme-sample.ttl', import.meta.url), 'utf-8');
  });

  let testingModule: TestingModule;
  let service: EntitiesService;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        GraphStoreModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => {
            const repository = new OxigraphLocalRepository();
            repository.loadTurtle(acmeOntology, WORKSPACE_IRI);
            return repository;
          }
        }),
        EntitiesModule
      ]
    }).compile();

    service = testingModule.get(EntitiesService);
    const graphStoreService = testingModule.get(GraphStoreService);
    expect(graphStoreService).toBeDefined();
  });

  afterEach(async () => {
    if (testingModule) {
      await testingModule.close();
    }
  });

  it('returns class details with direct restrictions', async () => {
    const details = await service.getEntityDetails(LOAN_IRI, WORKSPACE_IRI);

    expect(details.type).toBe('class');
    expect(details.labels).toContainEqual({ value: 'Loan', language: 'en' });
    expect(details.comment.value).toBe('');
    expect(details.superclasses).toEqual([ACCOUNT_IRI]);

    const restrictionKinds = details.restrictions.map((item) => item.kind).sort();
    expect(restrictionKinds).toEqual(['exact', 'max', 'some']);

    const someRestriction = details.restrictions.find(
      (restriction) => restriction.kind === 'some' && restriction.property === HAS_BORROWER_IRI
    ) as Restriction | undefined;
    expect(someRestriction).toBeDefined();
    if (someRestriction?.kind === 'some') {
      expect(someRestriction.target).toEqual({ type: 'iri', value: HAS_BORROWER_RANGE_IRI });
    }

    const exactRestriction = details.restrictions.find(
      (restriction) => restriction.kind === 'exact' && restriction.property === HAS_CURRENCY_IRI
    );
    expect(exactRestriction).toBeDefined();
    if (exactRestriction && exactRestriction.kind === 'exact') {
      expect(exactRestriction.cardinality).toBe(1);
      expect(exactRestriction.target).toEqual({ type: 'iri', value: HAS_CURRENCY_RANGE_IRI });
    }

    const maxRestriction = details.restrictions.find(
      (restriction) => restriction.kind === 'max' && restriction.property === HAS_GUARANTOR_IRI
    );
    expect(maxRestriction).toBeDefined();
    if (maxRestriction && maxRestriction.kind === 'max') {
      expect(maxRestriction.cardinality).toBe(1);
      expect(maxRestriction.target).toEqual({ type: 'iri', value: HAS_GUARANTOR_RANGE_IRI });
    }

    expect(details.domain).toEqual([]);
    expect(details.range).toEqual([]);
    expect(details.subPropertyOf).toEqual([]);
    expect(details.types).toContain('http://www.w3.org/2002/07/owl#Class');
  });

  it('returns property structural metadata', async () => {
    const details = await service.getEntityDetails(HAS_BORROWER_PROP_IRI, WORKSPACE_IRI);

    expect(details.type).toBe('property');
    expect(details.domain).toEqual(['http://acme.example/ontology#Loan']);
    expect(details.range).toEqual([HAS_BORROWER_RANGE_IRI]);
    expect(details.subPropertyOf).toEqual(['http://acme.example/ontology#hasOwner']);
    expect(details.restrictions).toEqual([]);
    expect(details.superclasses).toEqual([]);
  });

  it('returns individual types and annotations', async () => {
    const details = await service.getEntityDetails(LOAN123_IRI, WORKSPACE_IRI);

    expect(details.type).toBe('individual');
    expect(details.labels).toContainEqual({ value: 'Loan 123', language: 'en' });
    expect(details.comment.value).toContain("Alice's loan");
    expect(details.types).toContain(LOAN_IRI);
    expect(details.types).not.toContain(ACCOUNT_IRI);
    expect(details.types).not.toContain(PERSON_IRI);
    expect(details.domain).toEqual([]);
    expect(details.range).toEqual([]);
    expect(details.subPropertyOf).toEqual([]);
  });

  it('throws for unknown entity', async () => {
    await expect(service.getEntityDetails('http://acme.example/ontology#missing', WORKSPACE_IRI)).rejects.toThrow(
      /Entity not found/
    );
  });

  it('includes hasValue restriction values', async () => {
    const details = await service.getEntityDetails('http://acme.example/ontology#SwedishAccount', WORKSPACE_IRI);

    const hasValue = details.restrictions.find(
      (restriction) => restriction.kind === 'hasValue' && restriction.property === 'http://acme.example/ontology#hasCountry'
    );
    expect(hasValue).toBeDefined();
    if (hasValue && hasValue.kind === 'hasValue') {
      expect(hasValue.value).toEqual({ type: 'iri', value: 'http://acme.example/ontology#SE' });
    }
  });

  it('captures min qualified cardinalities on data properties', async () => {
    const details = await service.getEntityDetails('http://acme.example/ontology#Account', WORKSPACE_IRI);

    const exactRestriction = details.restrictions.find(
      (restriction) => restriction.kind === 'exact' && restriction.property === ACCOUNT_NUMBER_IRI
    );
    expect(exactRestriction).toBeDefined();
    if (exactRestriction && exactRestriction.kind === 'exact') {
      expect(exactRestriction.cardinality).toBe(1);
      expect(exactRestriction.target).toEqual({ type: 'datatype', value: 'http://www.w3.org/2001/XMLSchema#string' });
    }
  });
});
