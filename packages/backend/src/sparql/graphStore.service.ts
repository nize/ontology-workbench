import { Inject, Injectable } from '@nestjs/common';

import type { GraphStore, Quad, SparqlParams, SparqlRow } from './graphStore.js';
import { GRAPH_STORE } from './tokens.js';

@Injectable()
export class GraphStoreService implements GraphStore {
  constructor(@Inject(GRAPH_STORE) private readonly delegate: GraphStore) {}

  select(query: string, params?: SparqlParams, workspace?: string): Promise<SparqlRow[]> {
    return this.delegate.select(query, params, workspace);
  }

  construct(query: string, params?: SparqlParams, workspace?: string): Promise<Quad[]> {
    return this.delegate.construct(query, params, workspace);
  }

  update(query: string, params?: SparqlParams, workspace?: string): Promise<void> {
    return this.delegate.update(query, params, workspace);
  }
}
