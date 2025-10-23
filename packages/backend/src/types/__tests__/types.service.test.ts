import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import { TypesModule } from '../types.module.js';
import { TypesService } from '../types.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { GraphStoreService } from '../../sparql/graphStore.service.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://example.com/workspaces/types';
const ROOT_IRI = 'http://example.com/types#Root';
const ALPHA_IRI = 'http://example.com/types#Alpha';
const BETA_IRI = 'http://example.com/types#Beta';
const GAMMA_IRI = 'http://example.com/types#Gamma';
const DELTA_IRI = 'http://example.com/types#Delta';
const ZETA_IRI = 'http://example.com/types#Zeta';

let fixtureTurtle: string;

describe('TypesService', () => {
  beforeAll(async () => {
    fixtureTurtle = await readFile(new URL('../../../fixtures/types-tree.ttl', import.meta.url), 'utf-8');
  });

  let module: TestingModule;
  let service: TypesService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        GraphStoreModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => {
            const repository = new OxigraphLocalRepository();
            repository.loadTurtle(fixtureTurtle, WORKSPACE_IRI);
            return repository;
          }
        }),
        TypesModule
      ]
    }).compile();

    service = module.get(TypesService);
    expect(service).toBeDefined();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (module) {
      await module.close();
    }
  });

  it('builds deterministic tree with alt parent badges', async () => {
    const tree = await service.getTree({ depth: 2, workspace: WORKSPACE_IRI });

    expect(tree.map((node) => node.iri)).toEqual([ROOT_IRI, ZETA_IRI]);

    const rootNode = tree[0];
    expect(rootNode.children.map((child) => child.iri)).toEqual([ALPHA_IRI, BETA_IRI]);

    const alphaNode = rootNode.children.find((child) => child.iri === ALPHA_IRI);
    expect(alphaNode).toBeDefined();
    if (alphaNode) {
      expect(alphaNode.children.map((child) => child.iri)).toEqual([GAMMA_IRI]);
    }

    const gammaNode = alphaNode?.children[0];
    expect(gammaNode?.badges.altParents).toBe(1);
    expect(gammaNode?.hasChildren).toBe(true);
  });

  it('returns subtree for a specific root and respects depth', async () => {
    const [gammaWithoutChildren] = await service.getTree({
      root: GAMMA_IRI,
      depth: 0,
      workspace: WORKSPACE_IRI
    });
    expect(gammaWithoutChildren.children).toEqual([]);
    expect(gammaWithoutChildren.hasChildren).toBe(true);

    const [gammaWithChildren] = await service.getTree({
      root: GAMMA_IRI,
      depth: 1,
      workspace: WORKSPACE_IRI
    });
    expect(gammaWithChildren.children.map((child) => child.iri)).toEqual([DELTA_IRI]);
  });

  it('caches per workspace and invalidates on request', async () => {
    const graphStore = module.get(GraphStoreService);
    const selectSpy = vi.spyOn(graphStore, 'select');

    await service.getTree({ depth: 1, workspace: WORKSPACE_IRI });
    await service.getTree({ depth: 1, workspace: WORKSPACE_IRI });
    expect(selectSpy).toHaveBeenCalledTimes(3);

    service.invalidate(WORKSPACE_IRI);

    await service.getTree({ depth: 1, workspace: WORKSPACE_IRI });
    expect(selectSpy).toHaveBeenCalledTimes(6);
  });

  it('throws when root is missing', async () => {
    await expect(
      service.getTree({
        root: 'http://example.com/types#Missing',
        depth: 1,
        workspace: WORKSPACE_IRI
      })
    ).rejects.toThrow(/Type not found/);
  });
});
