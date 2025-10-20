import { GraphStoreError } from './errors.js';

export type SparqlBinding =
  | {
      type: 'iri';
      value: string;
    }
  | {
      type: 'literal';
      value: string;
      datatype?: string;
      language?: string;
    };

export type SparqlParamValue = SparqlBinding | string | number | boolean;
export type SparqlParams = Record<string, SparqlParamValue>;
export type SparqlRow = Record<string, SparqlBinding>;

export interface Term {
  termType: 'NamedNode' | 'Literal';
  value: string;
  datatype?: string;
  language?: string;
}

export interface Quad {
  subject: Term;
  predicate: Term;
  object: Term;
  graph?: Term;
}

export interface GraphStore {
  select(query: string, params?: SparqlParams, workspace?: string): Promise<SparqlRow[]>;
  construct(query: string, params?: SparqlParams, workspace?: string): Promise<Quad[]>;
  update(query: string, params?: SparqlParams, workspace?: string): Promise<void>;
}

const PARAM_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export function bindParams(
  query: string,
  params: SparqlParams = {},
  workspace?: string
): string {
  const boundParams: SparqlParams = { ...params };
  if (workspace) {
    boundParams.workspace ??= { type: 'iri', value: workspace };
  }

  return query.replace(PARAM_PATTERN, (_, key: string) => {
    if (!(key in boundParams)) {
      throw new GraphStoreError(`Missing parameter: ${key}`);
    }
    return serializeParam(boundParams[key]);
  });
}

export function serializeParam(value: SparqlParamValue): string {
  if (typeof value === 'string') {
    return literal(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : literal(value.toString());
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value.type === 'iri') {
    return `<${value.value}>`;
  }
  const escaped = literal(value.value);
  if (value.language) {
    return `${escaped}@${value.language}`;
  }
  if (value.datatype) {
    return `${escaped}^^<${value.datatype}>`;
  }
  return escaped;
}

function literal(input: string): string {
  const escaped = input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function mapSparqlJsonBinding(binding: any): SparqlBinding {
  if (!binding || typeof binding !== 'object' || typeof binding.value !== 'string') {
    throw new GraphStoreError('Invalid SPARQL binding');
  }
  if (binding.type === 'uri' || binding.type === 'iri') {
    return { type: 'iri', value: binding.value };
  }
  const language = binding['xml:lang'] ?? binding.language;
  return {
    type: 'literal',
    value: binding.value,
    datatype: binding.datatype,
    language
  };
}
