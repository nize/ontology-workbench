import oxigraph from 'oxigraph';
import { GraphStore, Quad, SparqlParams, SparqlRow, Term, bindParams } from './graphStore.js';
import { GraphStoreError } from './errors.js';

interface OxigraphLocalRepositoryOptions {
  path?: string | null;
  defaultGraph?: string;
}

export class OxigraphLocalRepository implements GraphStore {
  private readonly store: oxigraph.Store;
  private readonly defaultGraph?: string;

  constructor(options: OxigraphLocalRepositoryOptions = {}) {
    this.store = new oxigraph.Store();
    this.defaultGraph = options.defaultGraph;
  }

  async select(query: string, params: SparqlParams = {}, workspace?: string): Promise<SparqlRow[]> {
    const boundQuery = bindParams(query, params, workspace);
    
    try {
      const results = this.store.query(boundQuery);
      
      if (Array.isArray(results)) {
        if (results.length === 0) {
          return [];
        }
        // It's a list of bindings (SELECT query)
        if (results[0] instanceof Map) {
          return (results as Map<string, any>[]).map((binding) => {
            const row: SparqlRow = {};
            for (const [variable, term] of binding) {
              row[variable] = this.convertTermToBinding(term);
            }
            return row;
          });
        }
      }
      
      return [];
    } catch (error: any) {
      console.error('[Oxigraph] Query failed:', error);
      throw new GraphStoreError(`SPARQL Query failed: ${error.message}`);
    }
  }

  async construct(query: string, params: SparqlParams = {}, workspace?: string): Promise<Quad[]> {
    const boundQuery = bindParams(query, params, workspace);
    try {
      const results = this.store.query(boundQuery);
      if (Array.isArray(results)) {
         if (results.length > 0 && 'subject' in results[0] && 'predicate' in results[0]) {
            return results.map((q: any) => {
              const quad = this.convertOxiQuadToQuad(q);
              // If a workspace is provided, we assume the constructed quads belong to that workspace context
              // This matches the behavior of the previous simulated engine and is often expected by tests
              if (workspace && (!quad.graph || quad.graph.value === '')) {
                 quad.graph = { termType: 'NamedNode', value: workspace };
              }
              return quad;
            });
         }
         return [];
      }
      return [];
    } catch (error: any) {
      throw new GraphStoreError(`SPARQL Construct failed: ${error.message}`);
    }
  }

  async update(query: string, params: SparqlParams = {}, workspace?: string): Promise<void> {
    const boundQuery = bindParams(query, params, workspace);
    try {
      this.store.update(boundQuery);
    } catch (error: any) {
      throw new GraphStoreError(`SPARQL Update failed: ${error.message}`);
    }
  }

  loadTurtle(turtle: string, graph?: string): void {
    try {
      const graphNode = graph ? oxigraph.namedNode(graph) : undefined;
      const baseIri = graph ?? 'http://ontology-workbench.local/default';
      this.store.load(turtle, { format: 'text/turtle', base_iri: baseIri, to_graph_name: graphNode });
      console.log(`[Oxigraph] Loaded turtle data into graph <${graph ?? 'DEFAULT'}>`);
    } catch (error: any) {
      console.error(`[Oxigraph] Error loading turtle into graph <${graph ?? 'DEFAULT'}>:`, error);
    }
  }

  clearGraph(graph: string): void {
    const graphNode = oxigraph.namedNode(graph);
    const quads = this.store.match(null, null, null, graphNode);
    for (const quad of quads) {
      this.store.delete(quad);
    }
  }

  private convertTermToBinding(term: any): any {
    if (term.termType === 'NamedNode') {
      return { type: 'iri', value: term.value };
    }
    if (term.termType === 'Literal') {
      const binding: any = {
        type: 'literal',
        value: term.value,
      };
      if (term.language) {
        binding.language = term.language;
        // Omit datatype if it is rdf:langString to match standard JSON results and previous behavior
        if (term.datatype?.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString') {
           binding.datatype = term.datatype?.value;
        }
      } else if (term.datatype) {
        binding.datatype = term.datatype.value;
      }
      return binding;
    }
    if (term.termType === 'BlankNode') {
      return { type: 'iri', value: `urn:blank:${term.value}` };
    }
    return { type: 'literal', value: term.value };
  }

  private convertOxiQuadToQuad(q: any): Quad {
    return {
      subject: this.convertOxiTermToTerm(q.subject),
      predicate: this.convertOxiTermToTerm(q.predicate),
      object: this.convertOxiTermToTerm(q.object),
      graph: q.graph ? this.convertOxiTermToTerm(q.graph) : undefined
    };
  }

  private convertOxiTermToTerm(term: any): Term {
    return {
      termType: term.termType,
      value: term.value,
      language: term.language,
      datatype: term.datatype?.value
    };
  }
}

// Helper functions for manual parsing are no longer needed


