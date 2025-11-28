import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { GraphStore } from './graphStore.js';
import { GraphDBHttpRepository } from './graphdbRepository.js';
import { FusekiRepository } from './fusekiRepository.js';
import { OxigraphLocalRepository } from './oxigraphLocalRepository.js';

export interface GraphStoreFactoryEnv {
  BACKEND_SPARQL_DRIVER?: string;
  GRAPHDB_ENDPOINT?: string;
  GRAPHDB_AUTH_BASIC?: string;
  FUSEKI_ENDPOINT?: string;
  FUSEKI_AUTH_BASIC?: string;
  OXI_PATH?: string;
  REQUEST_TIMEOUT_MS?: string;
}

export type GraphStoreEnv = GraphStoreFactoryEnv | NodeJS.ProcessEnv;

export async function createGraphStoreFromEnv(env: GraphStoreEnv = process.env): Promise<GraphStore> {
  const driver = (env.BACKEND_SPARQL_DRIVER ?? 'graphdb').toLowerCase();
  const timeoutMs = env.REQUEST_TIMEOUT_MS ? Number.parseInt(env.REQUEST_TIMEOUT_MS, 10) : undefined;

  switch (driver) {
    case 'graphdb': {
      const endpoint = env.GRAPHDB_ENDPOINT;
      if (!endpoint) {
        throw new Error('GRAPHDB_ENDPOINT is required for GraphDB driver');
      }
      return new GraphDBHttpRepository({
        endpoint,
        timeoutMs,
        basicAuth: env.GRAPHDB_AUTH_BASIC ?? undefined
      });
    }
    case 'fuseki': {
      const endpoint = env.FUSEKI_ENDPOINT;
      if (!endpoint) {
        throw new Error('FUSEKI_ENDPOINT is required for Fuseki driver');
      }
      return new FusekiRepository({
        endpoint,
        timeoutMs,
        basicAuth: env.FUSEKI_AUTH_BASIC ?? undefined
      });
    }
    case 'oxigraph': {
      const repository = new OxigraphLocalRepository({
        path: env.OXI_PATH ?? null
      });
      // Load sample data
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const fixturesDir = join(__dirname, '../../fixtures');
      try {
        const schemaTurtle = await readFile(join(fixturesDir, 'schema.ttl'), 'utf-8');
        repository.loadTurtle(schemaTurtle, 'http://acme.example/default');
        const sampleDataTurtle = await readFile(join(fixturesDir, 'sample-data.ttl'), 'utf-8');
        repository.loadTurtle(sampleDataTurtle, 'http://acme.example/default');
        const acmeSampleTurtle = await readFile(join(fixturesDir, 'acme-sample.ttl'), 'utf-8');
        repository.loadTurtle(acmeSampleTurtle, 'http://acme.example/default');
      } catch (error) {
        console.warn('Failed to load fixtures:', error);
      }
      return repository;
    }
    default:
      throw new Error(`Unknown BACKEND_SPARQL_DRIVER: ${driver}`);
  }
}
