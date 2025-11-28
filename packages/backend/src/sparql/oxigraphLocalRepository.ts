import { GraphStore, Quad, SparqlParams, SparqlRow, Term, bindParams } from './graphStore.js';
import { GraphStoreError } from './errors.js';

interface OxigraphLocalRepositoryOptions {
  path?: string | null;
  defaultGraph?: string;
}

type BindingMap = Map<string, Term>;

type TermToken =
  | { type: 'variable'; name: string }
  | { type: 'iri'; value: string }
  | { type: 'literal'; value: string; language?: string; datatype?: string };

type QuadKey = string;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export class OxigraphLocalRepository implements GraphStore {
  private readonly graphs = new Map<string, Map<QuadKey, Quad>>();
  private readonly defaultGraph?: string;
  private readonly storePath?: string | null;

  constructor(options: OxigraphLocalRepositoryOptions = {}) {
    this.storePath = options.path ?? null;
    this.defaultGraph = options.defaultGraph ?? (this.storePath ? `file://${this.storePath}` : undefined);
  }

  async select(query: string, params: SparqlParams = {}, workspace?: string): Promise<SparqlRow[]> {
    const bound = bindParams(query, params, workspace);
    const { graph, patterns } = extractGraphPatterns(bound);
    const graphIri = graph ?? workspace ?? this.defaultGraph;
    console.log(`[Oxigraph] Select query on graph <${graphIri}>. Patterns: ${patterns.length}`);
    const quads = this.getGraph(graphIri);
    console.log(`[Oxigraph] Graph <${graphIri}> has ${quads.size} quads`);
    const bindings = evaluatePatterns(patterns, quads);
    console.log(`[Oxigraph] Found ${bindings.length} bindings`);
    return bindings.map((binding) => {
      const row: SparqlRow = {};
      for (const [name, term] of binding.entries()) {
        row[name] = termToBinding(term);
      }
      return row;
    });
  }

  async construct(query: string, params: SparqlParams = {}, workspace?: string): Promise<Quad[]> {
    const bound = bindParams(query, params, workspace);
    const { graph, patterns } = extractGraphPatterns(bound);
    const graphIri = graph ?? workspace ?? this.defaultGraph;
    const quads = this.getGraph(graphIri);
    if (patterns.length === 0) {
      return [...quads.values()];
    }
    const bindings = evaluatePatterns(patterns, quads);
    const results: Quad[] = [];
    for (const binding of bindings) {
      for (const pattern of patterns) {
        const quad = instantiatePattern(pattern, binding, graphIri);
        if (quad) {
          results.push(quad);
        }
      }
    }
    return results;
  }

  async update(query: string, params: SparqlParams = {}, workspace?: string): Promise<void> {
    const bound = bindParams(query, params, workspace);
    const insertMatch = bound.match(/INSERT\s+DATA\s*{\s*GRAPH\s+<([^>]+)>\s*{([\s\S]+?)}\s*}/i);
    if (!insertMatch) {
      throw new GraphStoreError('Only INSERT DATA statements are supported by the in-memory store');
    }
    const graph = insertMatch[1];
    const turtle = insertMatch[2];
    const quads = parseTurtle(turtle, graph);
    const graphStore = this.ensureGraph(graph);
    for (const quad of quads) {
      graphStore.set(quadKey(quad), quad);
    }
  }

  loadTurtle(turtle: string, graph: string): void {
    const quads = parseTurtle(turtle, graph);
    console.log(`[Oxigraph] Loading ${quads.length} quads into graph <${graph}>`);
    const graphStore = this.ensureGraph(graph);
    for (const quad of quads) {
      graphStore.set(quadKey(quad), quad);
    }
  }

  clearGraph(graph: string): void {
    this.graphs.delete(graph);
  }

  private ensureGraph(graph?: string | null): Map<QuadKey, Quad> {
    const iri = graph ?? this.defaultGraph;
    if (!iri) {
      throw new GraphStoreError('A graph IRI must be provided');
    }
    if (!this.graphs.has(iri)) {
      this.graphs.set(iri, new Map());
    }
    return this.graphs.get(iri)!;
  }

  private getGraph(graph?: string | null): Map<QuadKey, Quad> {
    if (!graph) {
      return new Map();
    }
    return this.graphs.get(graph) ?? new Map();
  }
}

function evaluatePatterns(patterns: Pattern[], quads: Map<QuadKey, Quad>): BindingMap[] {
  if (patterns.length === 0) {
    return [new Map()];
  }
  return matchPatternRecursive(patterns, [...quads.values()], [new Map()]);
}

function matchPatternRecursive(
  patterns: Pattern[],
  quads: Quad[],
  bindingsList: BindingMap[]
): BindingMap[] {
  if (patterns.length === 0) {
    return bindingsList;
  }
  const [pattern, ...rest] = patterns;
  const nextBindings: BindingMap[] = [];
  for (const binding of bindingsList) {
    for (const quad of quads) {
      const merged = mergeBinding(pattern, quad, binding);
      if (merged) {
        nextBindings.push(merged);
      }
    }
  }
  return matchPatternRecursive(rest, quads, nextBindings);
}

function mergeBinding(pattern: Pattern, quad: Quad, binding: BindingMap): BindingMap | null {
  const clone = new Map(binding);
  if (!unifyTerm(pattern.subject, quad.subject, clone)) {
    return null;
  }
  if (!unifyTerm(pattern.predicate, quad.predicate, clone)) {
    return null;
  }
  if (!unifyTerm(pattern.object, quad.object, clone)) {
    return null;
  }
  return clone;
}

function unifyTerm(token: TermToken, term: Term, binding: BindingMap): boolean {
  if (token.type === 'variable') {
    const existing = binding.get(token.name);
    if (!existing) {
      binding.set(token.name, term);
      return true;
    }
    return termsEqual(existing, term);
  }
  if (token.type === 'iri') {
    return term.termType === 'NamedNode' && term.value === token.value;
  }
  return (
    term.termType === 'Literal' &&
    term.value === token.value &&
    term.language === token.language &&
    term.datatype === token.datatype
  );
}

function termsEqual(a: Term, b: Term): boolean {
  return (
    a.termType === b.termType &&
    a.value === b.value &&
    a.language === b.language &&
    a.datatype === b.datatype
  );
}

function termToBinding(term: Term) {
  if (term.termType === 'NamedNode') {
    return { type: 'iri', value: term.value } as const;
  }
  return {
    type: 'literal',
    value: term.value,
    language: term.language,
    datatype: term.datatype
  } as const;
}

interface Pattern {
  subject: TermToken;
  predicate: TermToken;
  object: TermToken;
}

function extractGraphPatterns(query: string): { graph?: string; patterns: Pattern[] } {
  const graphMatch = query.match(/GRAPH\s+<([^>]+)>\s*{([\s\S]+?)}/i);
  if (graphMatch) {
    return {
      graph: graphMatch[1],
      patterns: parsePatterns(graphMatch[2])
    };
  }
  const whereMatch = query.match(/WHERE\s*{([\s\S]+?)}/i);
  if (!whereMatch) {
    throw new GraphStoreError('Unable to parse SPARQL query');
  }
  return { patterns: parsePatterns(whereMatch[1]) };
}

function parsePatterns(body: string): Pattern[] {
  const statements = splitStatements(body);
  const patterns: Pattern[] = [];
  for (const statement of statements) {
    if (!statement) continue;
    const [subjectToken, rest] = splitToken(statement);
    if (!subjectToken || !rest) {
      continue;
    }
    const subject = parseTermToken(subjectToken);
    const predicateGroups = rest.split(';').map((item) => item.trim()).filter(Boolean);
    for (let i = 0; i < predicateGroups.length; i++) {
      const group = predicateGroups[i]!;
      const [predicateToken, objectPart] = splitToken(group);
      if (!predicateToken || !objectPart) {
        continue;
      }
      const predicate = parsePredicateToken(predicateToken);
      const objects = splitObjects(objectPart);
      for (const objToken of objects) {
        const object = parseTermToken(objToken);
        patterns.push({ subject, predicate, object });
      }
    }
  }
  return patterns;
}

function parsePredicateToken(token: string): TermToken {
  if (token === 'a') {
    return { type: 'iri', value: RDF_TYPE };
  }
  return parseTermToken(token);
}

function parseTermToken(token: string): TermToken {
  if (token.startsWith('?')) {
    return { type: 'variable', name: token.slice(1) };
  }
  if (token.startsWith('<') && token.endsWith('>')) {
    return { type: 'iri', value: token.slice(1, -1) };
  }
  if (token.startsWith('"')) {
    const literal = parseLiteral(token);
    return {
      type: 'literal',
      value: literal.value,
      language: literal.language,
      datatype: literal.datatype
    };
  }
  throw new GraphStoreError(`Unsupported token: ${token}`);
}



function splitStatements(body: string): string[] {
  const sanitized = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .join(' ');
  const statements: string[] = [];
  let current = '';
  let inIri = false;
  let inString = false;

  for (let i = 0; i < sanitized.length; i += 1) {
    const char = sanitized[i]!;
    if (char === '<' && !inString) {
      inIri = true;
    } else if (char === '>' && inIri && !inString) {
      inIri = false;
    } else if (char === '"' && sanitized[i - 1] !== '\\') {
      inString = !inString;
    }

    if (char === '.' && !inIri && !inString) {
      const trimmed = current.trim().replace(/[{}]/g, '');
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const final = current.trim().replace(/[{}]/g, '');
  if (final) {
    statements.push(final);
  }

  return statements;
}

function splitToken(statement: string): [string | null, string | null] {
  const match = statement.trim().match(/^(\S+)\s+(.*)$/);
  if (!match) {
    return [null, null];
  }
  return [match[1] ?? null, match[2] ?? null];
}

function splitObjects(objectPart: string): string[] {
  const results: string[] = [];
  let current = '';
  let inString = false;
  let bracketDepth = 0;
  for (let i = 0; i < objectPart.length; i += 1) {
    const char = objectPart[i]!;
    if (char === '"' && objectPart[i - 1] !== '\\') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }
    if (char === ',' && !inString && bracketDepth === 0) {
      results.push(current.trim().replace(/[{}]/g, '').replace(/\.\s*$/, ''));
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    results.push(current.trim().replace(/[{}]/g, '').replace(/\.\s*$/, ''));
  }
  return results.map((value) => value.trim().replace(/\.\s*$/, '')).filter(Boolean);
}

function parseLiteral(token: string): { value: string; language?: string; datatype?: string } {
  let index = 1;
  let value = '';
  while (index < token.length) {
    const char = token[index]!;
    if (char === '"' && token[index - 1] !== '\\') {
      index += 1;
      break;
    }
    value += char;
    index += 1;
  }
  let language: string | undefined;
  let datatype: string | undefined;
  if (token[index] === '@') {
    index += 1;
    const start = index;
    while (index < token.length && /[a-zA-Z0-9-]/.test(token[index]!)) {
      index += 1;
    }
    language = token.slice(start, index);
  } else if (token[index] === '^' && token[index + 1] === '^') {
    index += 2;
    const iriStart = token.indexOf('<', index);
    const iriEnd = token.indexOf('>', iriStart + 1);
    datatype = token.slice(iriStart + 1, iriEnd);
  }
  return { value, language, datatype };
}

function parseTurtle(turtle: string, graph: string): Quad[] {
  const prefixes: Record<string, string> = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  };
  let blankNodeCounter = 0;
  const createBlankNode = () => `urn:blank:${graph}:${blankNodeCounter += 1}`;
  const statements = collectTurtleStatements(turtle);
  const quads: Quad[] = [];
  for (const statement of statements) {
    if (statement.startsWith('@prefix')) {
      const prefixMatch = statement.match(/@prefix\s+([^\s:]*):\s*<([^>]+)>/i);
      if (prefixMatch) {
        prefixes[prefixMatch[1]!] = prefixMatch[2]!;
      }
      continue;
    }
    const [subjectToken, rest] = splitToken(statement);
    if (!subjectToken || !rest) {
      continue;
    }
    const subject = expandSubject(subjectToken, prefixes);
    const predicateGroups = splitPredicateGroups(rest);
    for (const group of predicateGroups) {
      const [predicateToken, objectPart] = splitToken(group);
      if (!predicateToken || !objectPart) {
        continue;
      }
      const predicate = expandPredicate(predicateToken, prefixes);
      const objects = splitObjects(objectPart);
      for (const token of objects) {
        const object = expandObject(token, prefixes, quads, graph, createBlankNode);
        quads.push({
          subject,
          predicate,
          object,
          graph: { termType: 'NamedNode', value: graph }
        });
      }
    }
  }
  return quads;
}

function collectTurtleStatements(turtle: string): string[] {
  const lines = turtle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const statements: string[] = [];
  let buffer = '';
  for (const line of lines) {
    buffer += `${line} `;
    if (line.endsWith('.')) {
      statements.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) {
    statements.push(buffer.trim());
  }
  return statements;
}

function splitPredicateGroups(body: string): string[] {
  const groups: string[] = [];
  let current = '';
  let inString = false;
  let bracketDepth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (char === '"' && body[i - 1] !== '\\') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }
    if (char === ';' && !inString && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        groups.push(trimmed);
      }
      current = '';
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) {
    groups.push(trimmed);
  }
  return groups;
}

function expandSubject(token: string, prefixes: Record<string, string>): Term {
  return expandIriToken(token, prefixes);
}

function expandPredicate(token: string, prefixes: Record<string, string>): Term {
  if (token === 'a') {
    return { termType: 'NamedNode', value: RDF_TYPE };
  }
  return expandIriToken(token, prefixes);
}

function expandObject(
  token: string,
  prefixes: Record<string, string>,
  quads: Quad[],
  graph: string,
  createBlankNode: () => string
): Term {
  const trimmed = token.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const blankNodeValue = createBlankNode();
    const blankNode: Term = { termType: 'NamedNode', value: blankNodeValue };
    const inner = trimmed.slice(1, -1).trim();
    if (inner) {
      const groups = inner.split(';').map((group) => group.trim()).filter(Boolean);
      for (const group of groups) {
        const [predicateToken, objectPart] = splitToken(group);
        if (!predicateToken || !objectPart) {
          continue;
        }
        const predicate = expandPredicate(predicateToken, prefixes);
        const objects = splitObjects(objectPart);
        for (const value of objects) {
          const objectTerm = expandObject(value, prefixes, quads, graph, createBlankNode);
          quads.push({
            subject: blankNode,
            predicate,
            object: objectTerm,
            graph: { termType: 'NamedNode', value: graph }
          });
        }
      }
    }
    return blankNode;
  }
  if (trimmed.startsWith('"')) {
    const literal = parseLiteral(trimmed);
    return {
      termType: 'Literal',
      value: literal.value,
      language: literal.language,
      datatype: literal.datatype
    };
  }
  return expandIriToken(trimmed, prefixes);
}

function expandIriToken(token: string, prefixes: Record<string, string>): Term {
  if (token.startsWith('<') && token.endsWith('>')) {
    return { termType: 'NamedNode', value: token.slice(1, -1) };
  }
  if (token === 'a') {
    return { termType: 'NamedNode', value: RDF_TYPE };
  }
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) {
    throw new GraphStoreError(`Unknown prefixed name: ${token}`);
  }
  const prefix = token.slice(0, colonIndex);
  const local = token.slice(colonIndex + 1);
  if (!(prefix in prefixes)) {
    throw new GraphStoreError(`Unknown prefixed name: ${token}`);
  }
  return { termType: 'NamedNode', value: `${prefixes[prefix]!}${local}` };
}

function quadKey(quad: Quad): QuadKey {
  const graph = quad.graph?.value ?? '';
  return `${graph}|${quad.subject.value}|${quad.predicate.value}|${quad.object.termType}:${quad.object.value}`;
}

function instantiatePattern(pattern: Pattern, binding: BindingMap, graphIri?: string | null): Quad | null {
  const subject = resolveToken(pattern.subject, binding);
  const predicate = resolveToken(pattern.predicate, binding);
  const object = resolveToken(pattern.object, binding);
  if (!subject || !predicate || !object) {
    return null;
  }
  const graph = graphIri ? { termType: 'NamedNode' as const, value: graphIri } : undefined;
  return {
    subject,
    predicate,
    object,
    graph
  };
}

function resolveToken(token: TermToken, binding: BindingMap): Term | null {
  if (token.type === 'variable') {
    return binding.get(token.name) ?? null;
  }
  if (token.type === 'iri') {
    return { termType: 'NamedNode', value: token.value };
  }
  return {
    termType: 'Literal',
    value: token.value,
    language: token.language,
    datatype: token.datatype
  };
}

