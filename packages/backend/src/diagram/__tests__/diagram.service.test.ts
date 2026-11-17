import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { DiagramModule } from '../diagram.module.js';
import { DiagramService, DIAGRAM_MAX_EDGES } from '../diagram.service.js';
import { EntitiesService } from '../../entities/entities.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/test';
const LOAN_IRI = 'http://acme.example/ontology#Loan';
const HAS_BORROWER_IRI = 'http://acme.example/ontology#hasBorrower';
const HAS_CURRENCY_IRI = 'http://acme.example/ontology#hasCurrency';
const HAS_GUARANTOR_IRI = 'http://acme.example/ontology#hasGuarantor';
const PERSON_IRI = 'http://acme.example/ontology#Person';
const CURRENCY_IRI = 'http://acme.example/ontology#Currency';
const ORGANIZATION_IRI = 'http://acme.example/ontology#Organization';
const EUR_IRI = 'http://acme.example/ontology#EUR';
const LOAN_123_IRI = 'http://acme.example/ontology#loan123';
const ALICE_IRI = 'http://acme.example/ontology#alice';

let acmeOntology: string;

describe('DiagramService', () => {
  beforeAll(async () => {
    acmeOntology = await readFile(new URL('../../../fixtures/acme-sample.ttl', import.meta.url), 'utf-8');
  });

  let testingModule: TestingModule;
  let service: DiagramService;

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
        DiagramModule
      ]
    }).compile();

    service = testingModule.get(DiagramService);
    const entitiesService = testingModule.get(EntitiesService);
    expect(entitiesService).toBeDefined();
    // Sanity check wiring
    expect(service['entities']).toBeDefined();
  });

  afterEach(async () => {
    if (testingModule) {
      await testingModule.close();
    }
  });

  it('builds a radius-1 neighborhood from class restrictions', async () => {
    const diagram = await service.getDiagram(LOAN_IRI, 1, WORKSPACE_IRI);

    expect(diagram.center).toBe(LOAN_IRI);
    expect(diagram.radius).toBe(1);
    expect(diagram.truncated).toBe(false);

    const nodeIris = diagram.nodes.map((node) => node.iri);
    expect(nodeIris).toEqual(expect.arrayContaining([LOAN_IRI, PERSON_IRI, CURRENCY_IRI, ORGANIZATION_IRI]));

    const centerNode = diagram.nodes.find((node) => node.iri === LOAN_IRI);
    expect(centerNode?.isCenter).toBe(true);
    expect(centerNode?.label).toBe('Loan');

    const borrowerEdge = diagram.edges.find((edge) => edge.property === HAS_BORROWER_IRI);
    expect(borrowerEdge?.kind).toBe('some');
    const currencyEdge = diagram.edges.find((edge) => edge.property === HAS_CURRENCY_IRI);
    expect(currencyEdge?.kind).toBe('exact');
    expect(currencyEdge?.cardinality).toBe(1);
    const guarantorEdge = diagram.edges.find((edge) => edge.property === HAS_GUARANTOR_IRI);
    expect(guarantorEdge?.kind).toBe('max');
    expect(guarantorEdge?.cardinality).toBe(1);

    expect(new Set(diagram.edges.map((edge) => edge.id)).size).toBe(diagram.edges.length);
    expect(new Set(diagram.nodes.map((node) => node.id)).size).toBe(diagram.nodes.length);
  });

  it('includes incoming restriction edges for the selected class', async () => {
    const diagram = await service.getDiagram(CURRENCY_IRI, 1, WORKSPACE_IRI);

    const centerNode = diagram.nodes.find((node) => node.iri === CURRENCY_IRI);
    expect(centerNode?.isCenter).toBe(true);

    const loanNode = diagram.nodes.find((node) => node.iri === LOAN_IRI);
    expect(loanNode).toBeDefined();

    const incomingEdge = diagram.edges.find(
      (edge) =>
        edge.property === HAS_CURRENCY_IRI
        && edge.source === loanNode?.id
        && edge.target === centerNode?.id
    );

    expect(incomingEdge?.kind).toBe('exact');
    expect(incomingEdge?.cardinality).toBe(1);
  });

  it('shows the individuals of a class as instanceOf edges', async () => {
    const diagram = await service.getDiagram(CURRENCY_IRI, 1, WORKSPACE_IRI);

    const centerNode = diagram.nodes.find((node) => node.iri === CURRENCY_IRI);
    expect(centerNode?.kind).toBe('class');
    const eurNode = diagram.nodes.find((node) => node.iri === EUR_IRI);
    expect(eurNode?.kind).toBe('individual');
    expect(eurNode?.label).toBe('Euro');

    const instanceEdge = diagram.edges.find(
      (edge) => edge.kind === 'instanceOf' && edge.source === eurNode?.id && edge.target === centerNode?.id
    );
    expect(instanceEdge?.label).toBe('instance of');
  });

  it('centers on an individual with its types and property assertions', async () => {
    const diagram = await service.getDiagram(LOAN_123_IRI, 1, WORKSPACE_IRI);

    const byIri = new Map(diagram.nodes.map((node) => [node.iri, node]));
    expect(byIri.get(LOAN_123_IRI)?.isCenter).toBe(true);
    expect(byIri.get(LOAN_123_IRI)?.kind).toBe('individual');
    expect(byIri.get(LOAN_IRI)?.kind).toBe('class');
    expect(byIri.get(ALICE_IRI)?.kind).toBe('individual');
    expect(byIri.get(EUR_IRI)?.kind).toBe('individual');

    const borrower = diagram.edges.find((edge) => edge.property === HAS_BORROWER_IRI);
    expect(borrower).toMatchObject({
      kind: 'assertion',
      source: byIri.get(LOAN_123_IRI)?.id,
      target: byIri.get(ALICE_IRI)?.id,
      label: 'has borrower'
    });
    expect(diagram.edges.some(
      (edge) => edge.kind === 'instanceOf' && edge.target === byIri.get(LOAN_IRI)?.id
    )).toBe(true);
    // Literal-valued data properties are not drawn
    expect(diagram.nodes).toHaveLength(6);
  });

  it('caps edge count and signals truncation', async () => {
    await testingModule.close();
    const builder = Test.createTestingModule({
      imports: [
        GraphStoreModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => {
            const repository = new OxigraphLocalRepository();
            repository.loadTurtle(acmeOntology, WORKSPACE_IRI);
            return repository;
          }
        }),
        DiagramModule
      ]
    });

    builder.overrideProvider(DIAGRAM_MAX_EDGES).useValue(1);
    testingModule = await builder.compile();

    service = testingModule.get(DiagramService);

    const diagram = await service.getDiagram(LOAN_IRI, 1, WORKSPACE_IRI);
    expect(diagram.truncated).toBe(true);
    expect(diagram.edges.length).toBe(1);
    expect(diagram.nodes.length).toBe(2);
  });
});
