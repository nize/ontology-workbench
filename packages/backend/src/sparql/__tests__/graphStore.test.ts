import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { GraphStoreModule } from '../graphStore.module.js';
import { GraphStoreService } from '../graphStore.service.js';
import { OxigraphLocalRepository } from '../oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://example.com/workspaces/test';
const PERSON_IRI = 'http://example.com/Person';
const KNOWS_IRI = 'http://example.com/knows';

let schemaTurtle: string;
let sampleDataTurtle: string;

describe('OxigraphLocalRepository', () => {
  beforeAll(async () => {
    schemaTurtle = await readFile(new URL('../../../fixtures/schema.ttl', import.meta.url), 'utf-8');
    sampleDataTurtle = await readFile(new URL('../../../fixtures/sample-data.ttl', import.meta.url), 'utf-8');
  });

let testingModule: TestingModule;
let graphStore: GraphStoreService;

beforeEach(async () => {
  testingModule = await Test.createTestingModule({
    imports: [
      GraphStoreModule.forRootAsync({
        useFactory: async () => {
          const repository = new OxigraphLocalRepository();
          repository.loadTurtle(schemaTurtle, WORKSPACE_IRI);
          repository.loadTurtle(sampleDataTurtle, WORKSPACE_IRI);
          return repository;
        }
      })
    ]
  }).compile();

  graphStore = testingModule.get(GraphStoreService);
});

afterEach(async () => {
  await testingModule.close();
});

  it('returns rows for a simple SELECT query', async () => {
    const rows = await graphStore.select(
      `SELECT ?person WHERE {
        GRAPH {{workspace}} {
          ?person a <${PERSON_IRI}> .
        }
      }`,
      {},
      WORKSPACE_IRI
    );

    const iris = rows.map((row) => row.person.value).sort();
    expect(iris).toEqual([
      'http://example.com/alice',
      'http://example.com/bob'
    ]);
  });

  it('persists data written via UPDATE statements', async () => {
    await graphStore.update(
      `INSERT DATA {
        GRAPH {{workspace}} {
          <http://example.com/charlie> a <${PERSON_IRI}> .
        }
      }`,
      {},
      WORKSPACE_IRI
    );

    const rows = await graphStore.select(
      `SELECT ?person WHERE {
        GRAPH {{workspace}} {
          ?person a <${PERSON_IRI}> .
        }
      }`,
      {},
      WORKSPACE_IRI
    );

    const iris = rows.map((row) => row.person.value).sort();
    expect(iris).toEqual([
      'http://example.com/alice',
      'http://example.com/bob',
      'http://example.com/charlie'
    ]);
  });

  it('constructs quads from matching patterns', async () => {
    const quads = await graphStore.construct(
      `CONSTRUCT {
        ?s <${KNOWS_IRI}> ?o .
      }
      WHERE {
        GRAPH {{workspace}} {
          ?s <${KNOWS_IRI}> ?o .
        }
      }`,
      {},
      WORKSPACE_IRI
    );

    expect(quads).toHaveLength(1);
    expect(quads[0]!.subject.value).toBe('http://example.com/alice');
    expect(quads[0]!.object.value).toBe('http://example.com/bob');
    expect(quads[0]!.graph?.value).toBe(WORKSPACE_IRI);
  });
});
