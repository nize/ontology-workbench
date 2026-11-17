import {
  EntityType,
  type PropertyKind,
  type SearchFacetName,
  type SearchFacets,
  type SearchFacetValue,
  type SearchFilters,
  type SearchHighlight,
  type SearchHighlightField,
  type SearchHit,
  type SearchResponse
} from '@acme/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { SparqlBinding } from '../sparql/graphStore.js';
import { GraphStoreService } from '../sparql/graphStore.service.js';
import { DEFAULT_LANGUAGE, normalizeLanguage, pickByLanguage } from '@acme/shared';

const CLASS_TYPES = [
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class'
];

const PROPERTY_TYPES = [
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
  'http://www.w3.org/2002/07/owl#ObjectProperty',
  'http://www.w3.org/2002/07/owl#DatatypeProperty',
  'http://www.w3.org/2002/07/owl#AnnotationProperty',
  'http://www.w3.org/2002/07/owl#FunctionalProperty'
];

const PROPERTY_KINDS: Record<string, PropertyKind> = {
  'http://www.w3.org/2002/07/owl#ObjectProperty': 'object',
  'http://www.w3.org/2002/07/owl#DatatypeProperty': 'datatype',
  'http://www.w3.org/2002/07/owl#AnnotationProperty': 'annotation'
};

// Type assertions that say nothing about which class an individual belongs to.
const NON_CLASS_TYPES = new Set([
  'http://www.w3.org/2002/07/owl#NamedIndividual',
  'http://www.w3.org/2002/07/owl#Thing',
  'http://www.w3.org/2000/01/rdf-schema#Resource'
]);

const IS_DEFINED_BY = 'http://www.w3.org/2000/01/rdf-schema#isDefinedBy';
const OWL_DEPRECATED = 'http://www.w3.org/2002/07/owl#deprecated';

/** Facet values beyond this many (by count) are left out of the response. */
const MAX_FACET_VALUES = 50;

const LABEL_PREDICATES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2004/02/skos/core#prefLabel'
]);

const ALIAS_PREDICATES = new Set([
  'http://www.w3.org/2004/02/skos/core#altLabel',
  'http://www.w3.org/2004/02/skos/core#hiddenLabel'
]);

const COMMENT_PREDICATES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#comment',
  'http://www.w3.org/2004/02/skos/core#definition'
]);

const FIELD_WEIGHTS: Record<SearchHighlightField, number> = {
  label: 2000,
  alias: 1000,
  comment: 0
};

const MATCH_QUALITY = {
  exact: 500,
  prefix: 400,
  wordStart: 300,
  substring: 200,
  fuzzy: 100
} as const;

const TYPE_RANK: Record<EntityType, number> = { class: 3, property: 2, individual: 1 };

const TYPE_ASSERTIONS_QUERY = `
  SELECT ?entity ?type
  WHERE {
    {{graphStart}}
      ?entity a ?type .
    {{graphEnd}}
  }
`;

const ANNOTATIONS_QUERY = `
  SELECT ?entity ?predicate ?value
  WHERE {
    {{graphStart}}
      ?entity ?predicate ?value .
    {{graphEnd}}
  }
`;

type SearchDocument = {
  iri: string;
  type: EntityType;
  label: string;
  aliases: string[];
  comment: string;
  namespace: string;
  definedBy: string[];
  propertyKind?: PropertyKind;
  instanceOf: string[];
  deprecated: boolean;
};

type DocumentBuilder = {
  iri: string;
  type: EntityType;
  labels: SparqlBinding[];
  aliases: SparqlBinding[];
  comments: SparqlBinding[];
  typeIris: Set<string>;
  definedBy: Set<string>;
  deprecated: boolean;
};

type SearchIndex = {
  documents: SearchDocument[];
  byIri: Map<string, SearchDocument>;
};

export type SearchOptions = SearchFilters & {
  workspace?: string;
  /** Preferred language for the label and comment of each hit; defaults to English. */
  lang?: string;
  /** Kept for callers of the single-type API; merged into `types`. */
  type?: EntityType;
  limit?: number;
  offset?: number;
  /** Compute facet counts alongside the hits. */
  facets?: boolean;
};

type ScoredMatch = { doc: SearchDocument; match?: { score: number; highlight: SearchHighlight } };

const FACET_NAMES: SearchFacetName[] = ['type', 'definedBy', 'namespace', 'propertyKind', 'instanceOf', 'deprecated'];

@Injectable()
export class SearchService {
  private readonly indexes = new Map<string, SearchIndex>();
  private readonly builds = new Map<string, Promise<SearchIndex>>();

  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  async rebuildIndex(workspace?: string, lang = DEFAULT_LANGUAGE): Promise<number> {
    const key = this.indexKey(workspace, lang);
    const buildPromise = this.loadIndex(workspace, lang);
    this.builds.set(key, buildPromise);
    const index = await buildPromise;
    this.indexes.set(key, index);
    this.builds.delete(key);
    return index.documents.length;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const trimmedQuery = query.trim();
    const limit = this.normalizeLimit(options.limit);
    const offset = this.normalizeOffset(options.offset);
    const filters = this.normalizeFilters(options);
    const hasFilters = Object.values(filters).some((value) => (Array.isArray(value) ? value.length > 0 : value !== undefined));

    // An empty query only browses when the caller asked for filters or facets;
    // otherwise it stays the cheap no-op the type-ahead relies on.
    if (!trimmedQuery && !hasFilters && !options.facets) {
      return { query: '', limit, offset, total: 0, hits: [] } satisfies SearchResponse;
    }

    const lang = normalizeLanguage(options.lang);
    const index = await this.getIndex(options.workspace, lang);
    const normalizedQuery = trimmedQuery.toLowerCase();
    const fields = filters.fields && filters.fields.length > 0 ? new Set(filters.fields) : undefined;

    const textMatches: ScoredMatch[] = [];
    for (const doc of index.documents) {
      if (!normalizedQuery) {
        textMatches.push({ doc });
        continue;
      }
      const match = this.scoreDocument(doc, normalizedQuery, fields);
      if (match) {
        textMatches.push({ doc, match });
      }
    }

    const matches = textMatches
      .filter((item) => this.matchesFilters(item.doc, filters))
      .sort((a, b) => {
        const scoreA = a.match?.score ?? 0;
        const scoreB = b.match?.score ?? 0;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        if (a.doc.type !== b.doc.type) {
          return TYPE_RANK[b.doc.type] - TYPE_RANK[a.doc.type];
        }
        return a.doc.label.localeCompare(b.doc.label, undefined, { sensitivity: 'base' });
      });

    const total = matches.length;
    const hits: SearchHit[] = matches.slice(offset, offset + limit).map(({ doc, match }) => ({
      iri: doc.iri,
      type: doc.type,
      label: doc.label,
      comment: doc.comment,
      score: match?.score ?? 0,
      highlights: match ? [match.highlight] : [],
      deprecated: doc.deprecated,
      definedBy: doc.definedBy,
      propertyKind: doc.propertyKind,
      instanceOf: doc.instanceOf
    }));

    const response: SearchResponse = { query: trimmedQuery, limit, offset, total, hits };
    if (options.facets) {
      response.facets = this.computeFacets(
        textMatches.map((item) => item.doc),
        filters,
        index
      );
    }
    return response;
  }

  private normalizeFilters(options: SearchOptions): SearchFilters {
    const types = new Set(options.types ?? []);
    if (options.type) {
      types.add(options.type);
    }
    const deprecated = options.deprecated && options.deprecated !== 'include' ? options.deprecated : undefined;
    return {
      types: types.size > 0 ? Array.from(types) : undefined,
      definedBy: this.nonEmpty(options.definedBy),
      namespaces: this.nonEmpty(options.namespaces),
      propertyKinds: this.nonEmpty(options.propertyKinds),
      instanceOf: this.nonEmpty(options.instanceOf),
      deprecated,
      fields: this.nonEmpty(options.fields)
    };
  }

  private nonEmpty<T>(values?: T[]): T[] | undefined {
    return values && values.length > 0 ? values : undefined;
  }

  private matchesFilters(doc: SearchDocument, filters: SearchFilters, skip?: SearchFacetName): boolean {
    if (skip !== 'type' && filters.types && !filters.types.includes(doc.type)) {
      return false;
    }
    if (skip !== 'definedBy' && filters.definedBy && !doc.definedBy.some((iri) => filters.definedBy!.includes(iri))) {
      return false;
    }
    if (skip !== 'namespace' && filters.namespaces && !filters.namespaces.includes(doc.namespace)) {
      return false;
    }
    if (
      skip !== 'propertyKind' &&
      filters.propertyKinds &&
      (!doc.propertyKind || !filters.propertyKinds.includes(doc.propertyKind))
    ) {
      return false;
    }
    if (skip !== 'instanceOf' && filters.instanceOf && !doc.instanceOf.some((iri) => filters.instanceOf!.includes(iri))) {
      return false;
    }
    if (skip !== 'deprecated' && filters.deprecated) {
      if (filters.deprecated === 'exclude' && doc.deprecated) {
        return false;
      }
      if (filters.deprecated === 'only' && !doc.deprecated) {
        return false;
      }
    }
    return true;
  }

  private computeFacets(candidates: SearchDocument[], filters: SearchFilters, index: SearchIndex): SearchFacets {
    const counts = Object.fromEntries(FACET_NAMES.map((name) => [name, new Map<string, number>()])) as Record<
      SearchFacetName,
      Map<string, number>
    >;
    const bump = (facet: SearchFacetName, value: string) => {
      const map = counts[facet];
      map.set(value, (map.get(value) ?? 0) + 1);
    };

    for (const doc of candidates) {
      for (const facet of FACET_NAMES) {
        if (!this.matchesFilters(doc, filters, facet)) {
          continue;
        }
        switch (facet) {
          case 'type':
            bump(facet, doc.type);
            break;
          case 'definedBy':
            doc.definedBy.forEach((iri) => bump(facet, iri));
            break;
          case 'namespace':
            bump(facet, doc.namespace);
            break;
          case 'propertyKind':
            if (doc.propertyKind) {
              bump(facet, doc.propertyKind);
            }
            break;
          case 'instanceOf':
            doc.instanceOf.forEach((iri) => bump(facet, iri));
            break;
          case 'deprecated':
            bump(facet, doc.deprecated ? 'only' : 'exclude');
            break;
        }
      }
    }

    const selected: Record<SearchFacetName, string[]> = {
      type: filters.types ?? [],
      definedBy: filters.definedBy ?? [],
      namespace: filters.namespaces ?? [],
      propertyKind: filters.propertyKinds ?? [],
      instanceOf: filters.instanceOf ?? [],
      deprecated: filters.deprecated ? [filters.deprecated] : []
    };

    const toValues = (facet: SearchFacetName): SearchFacetValue[] => {
      const map = counts[facet];
      // Keep selected values visible even when nothing matches them any more.
      for (const value of selected[facet]) {
        if (!map.has(value)) {
          map.set(value, 0);
        }
      }
      const values = Array.from(map.entries())
        .map(([value, count]) => ({ value, count, label: this.facetLabel(facet, value, index) }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      const top = values.slice(0, MAX_FACET_VALUES);
      for (const value of values.slice(MAX_FACET_VALUES)) {
        if (selected[facet].includes(value.value)) {
          top.push(value);
        }
      }
      return top;
    };

    return Object.fromEntries(FACET_NAMES.map((facet) => [facet, toValues(facet)])) as SearchFacets;
  }

  private facetLabel(facet: SearchFacetName, value: string, index: SearchIndex): string {
    switch (facet) {
      case 'type':
        return { class: 'Class', property: 'Property', individual: 'Individual' }[value as EntityType] ?? value;
      case 'propertyKind':
        return { object: 'Object property', datatype: 'Datatype property', annotation: 'Annotation property' }[
          value as PropertyKind
        ] ?? value;
      case 'deprecated':
        return value === 'only' ? 'Deprecated' : 'Not deprecated';
      case 'namespace':
        return value;
      case 'definedBy':
      case 'instanceOf': {
        const doc = index.byIri.get(value) ?? index.byIri.get(value.replace(/[#/]$/, ''));
        return doc && doc.label !== doc.iri ? doc.label : this.shortName(value);
      }
    }
  }

  private async getIndex(workspace: string | undefined, lang: string): Promise<SearchIndex> {
    const key = this.indexKey(workspace, lang);
    const cached = this.indexes.get(key);
    if (cached) {
      return cached;
    }

    const inFlight = this.builds.get(key);
    if (inFlight) {
      return inFlight;
    }

    await this.rebuildIndex(workspace, lang);
    return this.indexes.get(key) ?? { documents: [], byIri: new Map() };
  }

  private prepareQuery(query: string, workspace?: string): string {
    if (workspace) {
      return query
        .replace('{{graphStart}}', 'GRAPH {{workspace}} {')
        .replace('{{graphEnd}}', '}');
    }
    return query
      .replace('{{graphStart}}', '')
      .replace('{{graphEnd}}', '');
  }

  private async loadIndex(workspace: string | undefined, lang: string): Promise<SearchIndex> {
    const [typeRows, annotationRows] = await Promise.all([
      this.graphStore.select(this.prepareQuery(TYPE_ASSERTIONS_QUERY, workspace), {}, workspace),
      this.graphStore.select(this.prepareQuery(ANNOTATIONS_QUERY, workspace), {}, workspace)
    ]);

    const builders = new Map<string, DocumentBuilder>();

    for (const row of typeRows) {
      const iri = row.entity?.type === 'iri' ? row.entity.value : undefined;
      const typeIri = row.type?.type === 'iri' ? row.type.value : undefined;
      if (!iri || iri.startsWith('urn:blank:') || !typeIri) {
        continue;
      }

      const builder = builders.get(iri) ?? {
        iri,
        type: 'individual',
        labels: [],
        aliases: [],
        comments: [],
        typeIris: new Set(),
        definedBy: new Set(),
        deprecated: false
      } satisfies DocumentBuilder;
      builder.typeIris.add(typeIri);

      const classification = this.classifyType(typeIri);
      if (classification) {
        builder.type = this.preferType(builder.type, classification);
      }

      builders.set(iri, builder);
    }

    for (const row of annotationRows) {
      const iri = row.entity?.type === 'iri' ? row.entity.value : undefined;
      const predicate = row.predicate?.type === 'iri' ? row.predicate.value : undefined;
      const value = row.value;
      if (!iri || !predicate || !value) {
        continue;
      }
      const builder = builders.get(iri);
      if (!builder) {
        continue;
      }

      if (predicate === IS_DEFINED_BY) {
        if (value.type === 'iri') {
          builder.definedBy.add(value.value);
        }
        continue;
      }
      if (value.type !== 'literal') {
        continue;
      }
      if (predicate === OWL_DEPRECATED) {
        builder.deprecated = ['true', '1'].includes(value.value.trim().toLowerCase());
      } else if (LABEL_PREDICATES.has(predicate)) {
        builder.labels.push(value);
      } else if (ALIAS_PREDICATES.has(predicate)) {
        builder.aliases.push(value);
      } else if (COMMENT_PREDICATES.has(predicate)) {
        builder.comments.push(value);
      }
    }

    const documents = Array.from(builders.values()).map((builder) => this.buildDocument(builder, lang));
    return { documents, byIri: new Map(documents.map((doc) => [doc.iri, doc])) };
  }

  private buildDocument(builder: DocumentBuilder, lang: string): SearchDocument {
    const label = this.resolveLabel(builder.labels, builder.iri, lang);
    const aliases = this.normalizeLiterals(builder.aliases);
    const comment = this.pickBestComment(builder.comments, lang);

    let propertyKind: PropertyKind | undefined;
    const instanceOf: string[] = [];
    for (const typeIri of builder.typeIris) {
      propertyKind ??= PROPERTY_KINDS[typeIri];
      if (builder.type === 'individual' && !NON_CLASS_TYPES.has(typeIri)) {
        instanceOf.push(typeIri);
      }
    }

    return {
      iri: builder.iri,
      type: builder.type,
      label,
      aliases,
      comment,
      namespace: this.namespaceOf(builder.iri),
      definedBy: Array.from(builder.definedBy).sort(),
      propertyKind: builder.type === 'property' ? propertyKind : undefined,
      instanceOf: instanceOf.sort(),
      deprecated: builder.deprecated
    } satisfies SearchDocument;
  }

  /** The IRI up to and including its last `#` or `/` (an IRI ending in one is its own namespace). */
  private namespaceOf(iri: string): string {
    const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
    if (cut >= 0) {
      return iri.slice(0, cut + 1);
    }
    const colon = iri.lastIndexOf(':');
    return colon >= 0 ? iri.slice(0, colon + 1) : iri;
  }

  /** A readable tail for IRIs that have no label of their own, e.g. module IRIs ending in `/`. */
  private shortName(iri: string): string {
    const trimmed = iri.replace(/[#/]+$/, '');
    const tail = this.fallbackLabel(trimmed);
    return tail || iri;
  }

  private classifyType(typeIri: string): EntityType | undefined {
    if (CLASS_TYPES.includes(typeIri)) {
      return 'class';
    }
    if (PROPERTY_TYPES.includes(typeIri)) {
      return 'property';
    }
    return undefined;
  }

  private preferType(existing: EntityType, next: EntityType): EntityType {
    const priority: Record<EntityType, number> = {
      class: 3,
      property: 2,
      individual: 1
    };
    return priority[next] > priority[existing] ? next : existing;
  }

  private normalizeLiterals(values: SparqlBinding[]): string[] {
    const seen = new Set<string>();
    const literals: string[] = [];
    for (const value of values) {
      if (value.type === 'literal') {
        const key = `${value.value}|${value.language ?? ''}|${value.datatype ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          literals.push(value.value);
        }
      }
    }
    return literals.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  private resolveLabel(labels: SparqlBinding[], iri: string, lang: string): string {
    const literalLabels = labels.filter((item) => item.type === 'literal');
    return pickByLanguage(literalLabels, lang)?.value ?? this.fallbackLabel(iri);
  }

  private pickBestComment(comments: SparqlBinding[], lang: string): string {
    const literals = comments.filter((item) => item.type === 'literal');
    return pickByLanguage(literals, lang)?.value ?? '';
  }

  private fallbackLabel(iri: string): string {
    const hashIndex = iri.lastIndexOf('#');
    if (hashIndex >= 0 && hashIndex < iri.length - 1) {
      return iri.slice(hashIndex + 1);
    }
    const slashIndex = iri.lastIndexOf('/');
    if (slashIndex >= 0 && slashIndex < iri.length - 1) {
      return iri.slice(slashIndex + 1);
    }
    return iri;
  }

  private scoreDocument(
    doc: SearchDocument,
    normalizedQuery: string,
    onlyFields?: Set<SearchHighlightField>
  ): { score: number; highlight: SearchHighlight } | undefined {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestHighlight: SearchHighlight | undefined;

    const fields: { field: SearchHighlightField; value: string }[] = [
      { field: 'label', value: doc.label },
      ...doc.aliases.map((alias) => ({ field: 'alias' as const, value: alias })),
      { field: 'comment', value: doc.comment }
    ];

    for (const field of fields) {
      if (onlyFields && !onlyFields.has(field.field)) {
        continue;
      }
      const scored = this.scoreField(field.value, normalizedQuery, field.field);
      if (scored && scored.score > bestScore) {
        bestScore = scored.score;
        bestHighlight = scored.highlight;
      }
    }

    if (bestHighlight) {
      return { score: bestScore, highlight: bestHighlight };
    }
    return undefined;
  }

  private scoreField(
    value: string,
    normalizedQuery: string,
    field: SearchHighlightField
  ): { score: number; highlight: SearchHighlight } | undefined {
    if (!value) {
      return undefined;
    }

    // Matches on the entity's own name always outrank matches in its description:
    // each field gets its own score band, and within a band an exact match beats a
    // prefix, which beats a word start, which beats a substring, which beats fuzzy.
    const weight = FIELD_WEIGHTS[field];
    const normalizedValue = value.toLowerCase();
    const index = normalizedValue.indexOf(normalizedQuery);
    if (index >= 0) {
      const wordStart = index === 0 ? 0 : this.findWordStart(normalizedValue, normalizedQuery);
      let quality: number;
      if (normalizedValue === normalizedQuery) {
        quality = MATCH_QUALITY.exact;
      } else if (index === 0) {
        quality = MATCH_QUALITY.prefix;
      } else if (wordStart >= 0) {
        quality = MATCH_QUALITY.wordStart;
      } else {
        quality = MATCH_QUALITY.substring;
      }
      const wordIndex = wordStart >= 0 ? wordStart : index;
      // Small tie-breakers: earlier matches and tighter values (shorter labels) rank higher.
      const tieBreak = Math.max(0, 50 - wordIndex) / 100 + Math.max(0, 50 - value.length) / 1000;
      return {
        score: weight + quality + tieBreak,
        highlight: { field, snippet: this.highlightSnippet(value, wordIndex, normalizedQuery.length) }
      } satisfies { score: number; highlight: SearchHighlight };
    }

    // Fuzzy matching only makes sense against short, name-like fields.
    if (field === 'comment') {
      return undefined;
    }
    const distance = Math.min(
      levenshteinDistance(normalizedQuery, normalizedValue),
      levenshteinDistance(normalizedQuery, normalizedValue.slice(0, normalizedQuery.length))
    );
    const tolerance = Math.max(1, Math.floor(normalizedQuery.length / 3));
    if (distance <= tolerance) {
      return {
        score: weight + MATCH_QUALITY.fuzzy - distance,
        highlight: {
          field,
          snippet: this.highlightSnippet(value, 0, Math.min(value.length, normalizedQuery.length))
        }
      } satisfies { score: number; highlight: SearchHighlight };
    }

    return undefined;
  }

  private findWordStart(normalizedValue: string, normalizedQuery: string): number {
    let index = normalizedValue.indexOf(normalizedQuery);
    while (index >= 0) {
      if (index === 0 || !/[\p{L}\p{N}]/u.test(normalizedValue[index - 1]!)) {
        return index;
      }
      index = normalizedValue.indexOf(normalizedQuery, index + 1);
    }
    return -1;
  }

  private highlightSnippet(text: string, start: number, length: number): string {
    const safeStart = Math.max(0, start);
    const match = text.slice(safeStart, safeStart + length);
    const prefix = text.slice(Math.max(0, safeStart - 20), safeStart);
    const suffix = text.slice(safeStart + length, safeStart + length + 20);
    return `${prefix}<mark>${match}</mark>${suffix}`;
  }

  private indexKey(workspace: string | undefined, lang: string): string {
    return `${workspace ?? 'DEFAULT'}|${lang}`;
  }

  private normalizeLimit(limit?: number): number {
    if (!limit || !Number.isFinite(limit) || limit <= 0) {
      return 10;
    }
    return Math.min(Math.floor(limit), 100);
  }

  private normalizeOffset(offset?: number): number {
    if (!offset || !Number.isFinite(offset) || offset < 0) {
      return 0;
    }
    return Math.floor(offset);
  }
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}
