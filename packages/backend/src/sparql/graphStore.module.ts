import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { createGraphStoreFromEnv, type GraphStoreEnv } from './factory.js';
import type { GraphStore } from './graphStore.js';
import { GraphStoreService } from './graphStore.service.js';
import { GRAPH_STORE } from './tokens.js';

export interface GraphStoreModuleOptions {
  env?: GraphStoreEnv;
  isGlobal?: boolean;
  createGraphStore?: (env: GraphStoreEnv) => GraphStore | Promise<GraphStore>;
}

export interface GraphStoreModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  isGlobal?: boolean;
  createGraphStore?: (env: GraphStoreEnv) => GraphStore | Promise<GraphStore>;
  useFactory: (
    ...args: any[]
  ) =>
    | Promise<GraphStore | GraphStoreEnv | undefined>
    | GraphStore
    | GraphStoreEnv
    | undefined;
}

@Module({})
export class GraphStoreModule {
  static forRoot(options: GraphStoreModuleOptions = {}): DynamicModule {
    const env = (options.env ?? process.env) as GraphStoreEnv;
    const createGraphStore = options.createGraphStore ?? createGraphStoreFromEnv;
    const providers: Provider[] = [
      {
        provide: GRAPH_STORE,
        useFactory: async () => createGraphStore(env)
      },
      GraphStoreService
    ];

    return {
      module: GraphStoreModule,
      global: options.isGlobal ?? false,
      providers,
      exports: [GRAPH_STORE, GraphStoreService]
    };
  }

  static forRootAsync(options: GraphStoreModuleAsyncOptions): DynamicModule {
    const createGraphStore = options.createGraphStore ?? createGraphStoreFromEnv;
    const providers: Provider[] = [
      {
        provide: GRAPH_STORE,
        useFactory: async (...args: any[]) =>
          resolveGraphStore(options.useFactory(...args), createGraphStore),
        inject: options.inject ?? []
      },
      GraphStoreService
    ];

    return {
      module: GraphStoreModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers,
      exports: [GRAPH_STORE, GraphStoreService]
    };
  }
}

function isGraphStore(value: unknown): value is GraphStore {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GraphStore).select === 'function' &&
    typeof (value as GraphStore).construct === 'function' &&
    typeof (value as GraphStore).update === 'function'
  );
}

async function resolveGraphStore(
  input:
    | GraphStore
    | GraphStoreEnv
    | undefined
    | Promise<GraphStore | GraphStoreEnv | undefined>,
  createGraphStore: (env: GraphStoreEnv) => GraphStore | Promise<GraphStore>
): Promise<GraphStore> {
  const value = await input;
  if (isGraphStore(value)) {
    return value;
  }
  const env = (value ?? process.env) as GraphStoreEnv;
  return createGraphStore(env);
}
