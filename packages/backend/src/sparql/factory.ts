import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
  PRELOAD_TURTLE_FILES?: string;
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
        path: env.OXI_PATH ?? null,
        defaultGraph: 'http://acme.example/default'
      });
      // Load sample data
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const fixturesDir = join(__dirname, '../../fixtures');
      try {
        const schemaTurtle = await readFile(join(fixturesDir, 'schema.ttl'), 'utf-8');
        repository.loadTurtle(schemaTurtle);
        const sampleDataTurtle = await readFile(join(fixturesDir, 'sample-data.ttl'), 'utf-8');
        repository.loadTurtle(sampleDataTurtle);
        const acmeSampleTurtle = await readFile(join(fixturesDir, 'acme-sample.ttl'), 'utf-8');
        repository.loadTurtle(acmeSampleTurtle);
      } catch (error) {
        console.warn('Failed to load fixtures:', error);
      }

      // Load additional files from env
      if (env.PRELOAD_TURTLE_FILES) {
        const files = env.PRELOAD_TURTLE_FILES.split(',');
        for (const filePath of files) {
          try {
            const trimmedPath = filePath.trim();
            if (!trimmedPath) continue;
            // Resolve path relative to CWD (which is packages/backend when running via local-dev)
            // or absolute path
            const resolvedPath = resolve(process.cwd(), trimmedPath);
            console.log(`[Oxigraph] Loading additional turtle file: ${resolvedPath}`);
            const content = await readFile(resolvedPath, 'utf-8');
            // Use a different graph for FIBO or other external ontologies if needed, 
            // but for now we load everything into the default graph so it's searchable.
            repository.loadTurtle(content);
          } catch (error) {
            console.error(`[Oxigraph] Failed to load additional turtle file ${filePath}:`, error);
          }
        }
      }

      return repository;
    }
    default:
      throw new Error(`Unknown BACKEND_SPARQL_DRIVER: ${driver}`);
  }
}
