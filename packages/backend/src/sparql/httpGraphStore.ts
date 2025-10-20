import { bindParams, GraphStore, Quad, SparqlParams, SparqlRow, mapSparqlJsonBinding } from './graphStore.js';
import { GraphStoreError, GraphStoreHttpError, GraphStoreTimeoutError } from './errors.js';

export interface HttpGraphStoreOptions {
  driver: string;
  queryUrl: string;
  updateUrl: string;
  constructUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10000;

export abstract class HttpGraphStore implements GraphStore {
  protected readonly driver: string;
  protected readonly queryUrl: string;
  protected readonly updateUrl: string;
  protected readonly constructUrl: string;
  protected readonly headers: Record<string, string>;
  protected readonly timeoutMs: number;

  protected constructor(options: HttpGraphStoreOptions) {
    this.driver = options.driver;
    this.queryUrl = options.queryUrl;
    this.updateUrl = options.updateUrl;
    this.constructUrl = options.constructUrl ?? options.queryUrl;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async select(query: string, params: SparqlParams = {}, workspace?: string): Promise<SparqlRow[]> {
    const response = await this.executeQuery('select', this.queryUrl, query, params, workspace, 'application/sparql-results+json');
    const json = await response.json();
    if (!json?.results?.bindings) {
      throw new GraphStoreError('Malformed SPARQL JSON response');
    }
    return json.results.bindings.map((row: Record<string, any>) => {
      const mapped: SparqlRow = {};
      for (const [key, value] of Object.entries(row)) {
        mapped[key] = mapSparqlJsonBinding(value);
      }
      return mapped;
    });
  }

  async construct(query: string, params: SparqlParams = {}, workspace?: string): Promise<Quad[]> {
    const response = await this.executeQuery('construct', this.constructUrl, query, params, workspace, 'application/n-triples');
    const text = await response.text();
    return parseNTriples(text);
  }

  async update(query: string, params: SparqlParams = {}, workspace?: string): Promise<void> {
    await this.executeQuery('update', this.updateUrl, query, params, workspace, 'application/sparql-update');
  }

  private async executeQuery(
    operation: 'select' | 'construct' | 'update',
    url: string,
    query: string,
    params: SparqlParams,
    workspace: string | undefined,
    accept: string
  ): Promise<Response> {
    const boundQuery = bindParams(query, params, workspace);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        Accept: accept,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...this.headers
      },
      body: new URLSearchParams({ query: boundQuery }).toString(),
      signal: controller.signal
    };

    try {
      const response = await fetch(url, requestInit);
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        const body = await response.text();
        this.log('error', operation, latencyMs, { status: response.status, body });
        throw new GraphStoreHttpError(
          `SPARQL ${operation.toUpperCase()} failed with status ${response.status}`,
          response.status,
          body
        );
      }
      this.log('info', operation, latencyMs, { status: response.status });
      return response;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.log('error', operation, latencyMs, { code: 'TIMEOUT' });
        throw new GraphStoreTimeoutError(this.timeoutMs);
      }
      this.log('error', operation, latencyMs, { message: (error as Error).message });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected log(level: 'info' | 'error', operation: string, latencyMs: number, extra: Record<string, unknown>): void {
    const payload = {
      level,
      msg: `sparql.${operation}`,
      driver: this.driver,
      latencyMs,
      ...extra
    };
    if (level === 'error') {
      console.error(JSON.stringify(payload));
    } else {
      console.info(JSON.stringify(payload));
    }
  }
}

function parseNTriples(input: string): Quad[] {
  const quads: Quad[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const quad = parseNTripleLine(trimmed);
    if (quad) {
      quads.push(quad);
    }
  }
  return quads;
}

function parseNTripleLine(line: string): Quad | null {
  let index = 0;

  function skipWhitespace(): void {
    while (index < line.length && /\s/.test(line[index]!)) {
      index += 1;
    }
  }

  function readIri(): string {
    if (line[index] !== '<') {
      throw new GraphStoreError(`Expected IRI at position ${index}`);
    }
    index += 1;
    let value = '';
    while (index < line.length && line[index] !== '>') {
      value += line[index];
      index += 1;
    }
    if (line[index] !== '>') {
      throw new GraphStoreError('Unterminated IRI');
    }
    index += 1;
    return value;
  }

  function readLiteral(): { value: string; language?: string; datatype?: string } {
    if (line[index] !== '"') {
      throw new GraphStoreError(`Expected literal at position ${index}`);
    }
    index += 1;
    let value = '';
    while (index < line.length) {
      const char = line[index]!;
      if (char === '"' && line[index - 1] !== '\\') {
        index += 1;
        break;
      }
      value += char;
      index += 1;
    }
    let language: string | undefined;
    let datatype: string | undefined;
    if (line[index] === '@') {
      index += 1;
      const start = index;
      while (index < line.length && /[a-zA-Z0-9-]/.test(line[index]!)) {
        index += 1;
      }
      language = line.slice(start, index);
    } else if (line[index] === '^' && line[index + 1] === '^') {
      index += 2;
      datatype = readIri();
    }
    return { value, language, datatype };
  }

  skipWhitespace();
  if (!line) {
    return null;
  }
  const subject = readIri();
  skipWhitespace();
  const predicate = readIri();
  skipWhitespace();
  let object;
  if (line[index] === '<') {
    object = { termType: 'NamedNode' as const, value: readIri() };
  } else if (line[index] === '"') {
    const literal = readLiteral();
    object = {
      termType: 'Literal' as const,
      value: literal.value,
      language: literal.language,
      datatype: literal.datatype
    };
  } else {
    throw new GraphStoreError('Unsupported object term in N-Triples parser');
  }
  skipWhitespace();
  let graph;
  if (line[index] === '<') {
    graph = { termType: 'NamedNode' as const, value: readIri() };
    skipWhitespace();
  }
  if (line[index] !== '.') {
    throw new GraphStoreError('Expected . terminator in N-Triples line');
  }
  return {
    subject: { termType: 'NamedNode', value: subject },
    predicate: { termType: 'NamedNode', value: predicate },
    object,
    graph
  };
}
