import { EntityType, type SearchHighlight, type SearchHighlightField, type SearchHit, type SearchResponse } from '@acme/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { SparqlBinding } from '../sparql/graphStore.js';
import { GraphStoreService } from '../sparql/graphStore.service.js';

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

const TYPE_ASSERTIONS_QUERY = `
  SELECT ?entity ?type
  WHERE {
    GRAPH {{workspace}} {
      ?entity a ?type .
    }
  }
`;

const ANNOTATIONS_QUERY = `
  SELECT ?entity ?predicate ?value
  WHERE {
    GRAPH {{workspace}} {
      ?entity ?predicate ?value .
    }
  }
`;

type SearchDocument = {
  iri: string;
  type: EntityType;
  label: string;
  aliases: string[];
  comment: string;
};

type DocumentBuilder = {
  iri: string;
  type: EntityType;
  labels: SparqlBinding[];
  aliases: SparqlBinding[];
  comments: SparqlBinding[];
};

@Injectable()
export class SearchService {
  private readonly indexes = new Map<string, SearchDocument[]>();
  private readonly builds = new Map<string, Promise<SearchDocument[]>>();

  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  async rebuildIndex(workspace?: string): Promise<number> {
    const key = this.workspaceKey(workspace);
    const buildPromise = this.loadIndex(workspace);
    this.builds.set(key, buildPromise);
    const documents = await buildPromise;
    this.indexes.set(key, documents);
    this.builds.delete(key);
    return documents.length;
  }

  async search(
    query: string,
    options: { workspace?: string; type?: EntityType; limit?: number; offset?: number } = {}
  ): Promise<SearchResponse> {
    const trimmedQuery = query.trim();
    const limit = this.normalizeLimit(options.limit);
    const offset = this.normalizeOffset(options.offset);

    if (!trimmedQuery) {
      return { query: '', limit, offset, total: 0, hits: [] } satisfies SearchResponse;
    }

    const workspaceKey = this.workspaceKey(options.workspace);
    const documents = await this.getIndex(workspaceKey, options.workspace);
    const filtered = options.type ? documents.filter((doc) => doc.type === options.type) : documents;

    const matches = filtered
      .map((doc) => ({ doc, match: this.scoreDocument(doc, trimmedQuery.toLowerCase()) }))
      .filter((item): item is { doc: SearchDocument; match: { score: number; highlight: SearchHighlight } } =>
        Boolean(item.match)
      )
      .sort((a, b) => {
        if (a.match.score !== b.match.score) {
          return b.match.score - a.match.score;
        }
        return a.doc.label.localeCompare(b.doc.label, undefined, { sensitivity: 'base' });
      });

    const total = matches.length;
    const hits: SearchHit[] = matches.slice(offset, offset + limit).map(({ doc, match }) => ({
      iri: doc.iri,
      type: doc.type,
      label: doc.label,
      comment: doc.comment,
      score: match.score,
      highlights: [match.highlight]
    }));

    return { query: trimmedQuery, limit, offset, total, hits } satisfies SearchResponse;
  }

  private async getIndex(key: string, workspace?: string): Promise<SearchDocument[]> {
    const cached = this.indexes.get(key);
    if (cached) {
      return cached;
    }

    const inFlight = this.builds.get(key);
    if (inFlight) {
      return inFlight;
    }

    await this.rebuildIndex(workspace);
    return this.indexes.get(key) ?? [];
  }

  private async loadIndex(workspace?: string): Promise<SearchDocument[]> {
    const [typeRows, annotationRows] = await Promise.all([
      this.graphStore.select(TYPE_ASSERTIONS_QUERY, {}, workspace),
      this.graphStore.select(ANNOTATIONS_QUERY, {}, workspace)
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
        comments: []
      } satisfies DocumentBuilder;

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
      if (!iri || !predicate || value?.type !== 'literal') {
        continue;
      }
      const builder = builders.get(iri);
      if (!builder) {
        continue;
      }

      if (LABEL_PREDICATES.has(predicate)) {
        builder.labels.push(value);
      } else if (ALIAS_PREDICATES.has(predicate)) {
        builder.aliases.push(value);
      } else if (COMMENT_PREDICATES.has(predicate)) {
        builder.comments.push(value);
      }
    }

    return Array.from(builders.values()).map((builder) => this.buildDocument(builder));
  }

  private buildDocument(builder: DocumentBuilder): SearchDocument {
    const label = this.resolveLabel(builder.labels, builder.iri);
    const aliases = this.normalizeLiterals(builder.aliases);
    const comment = this.pickBestComment(builder.comments);

    return {
      iri: builder.iri,
      type: builder.type,
      label,
      aliases,
      comment
    } satisfies SearchDocument;
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

  private resolveLabel(labels: SparqlBinding[], iri: string): string {
    const literalLabels = labels.filter((item) => item.type === 'literal');
    if (literalLabels.length === 0) {
      return this.fallbackLabel(iri);
    }

    const sorted = [...literalLabels].sort((a, b) => {
      if (a.language === 'en' && b.language !== 'en') {
        return -1;
      }
      if (a.language !== 'en' && b.language === 'en') {
        return 1;
      }
      if (!a.language && b.language) {
        return -1;
      }
      if (a.language && !b.language) {
        return 1;
      }

      const valueCompare = a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
      if (valueCompare !== 0) {
        return valueCompare;
      }

      const langA = a.language ?? '';
      const langB = b.language ?? '';
      return langA.localeCompare(langB);
    });

    return sorted[0].value;
  }

  private pickBestComment(comments: SparqlBinding[]): string {
    const literals = comments.filter((item) => item.type === 'literal');
    if (literals.length === 0) {
      return '';
    }
    const preferred = literals.find((item) => item.language === 'en') ?? literals[0]!;
    return preferred.value;
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
    normalizedQuery: string
  ): { score: number; highlight: SearchHighlight } | undefined {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestHighlight: SearchHighlight | undefined;

    const fields: { field: SearchHighlightField; value: string }[] = [
      { field: 'label', value: doc.label },
      ...doc.aliases.map((alias) => ({ field: 'alias' as const, value: alias })),
      { field: 'comment', value: doc.comment }
    ];

    for (const field of fields) {
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

    const normalizedValue = value.toLowerCase();
    const index = normalizedValue.indexOf(normalizedQuery);
    if (index >= 0) {
      const prefixBoost = index === 0 ? 20 : 0;
      const score = 100 - index + prefixBoost + Math.min(normalizedQuery.length, 10);
      return {
        score,
        highlight: { field, snippet: this.highlightSnippet(value, index, normalizedQuery.length) }
      } satisfies { score: number; highlight: SearchHighlight };
    }

    const comparisonTarget = normalizedValue.slice(0, Math.max(80, normalizedQuery.length + 5));
    const distance = levenshteinDistance(normalizedQuery, comparisonTarget);
    const tolerance = Math.max(2, Math.floor(normalizedQuery.length / 3));
    if (distance <= tolerance) {
      const score = 60 - distance + Math.min(normalizedQuery.length, 10);
      return {
        score,
        highlight: {
          field,
          snippet: this.highlightSnippet(value, 0, Math.min(value.length, normalizedQuery.length))
        }
      } satisfies { score: number; highlight: SearchHighlight };
    }

    return undefined;
  }

  private highlightSnippet(text: string, start: number, length: number): string {
    const safeStart = Math.max(0, start);
    const match = text.slice(safeStart, safeStart + length);
    const prefix = text.slice(Math.max(0, safeStart - 20), safeStart);
    const suffix = text.slice(safeStart + length, safeStart + length + 20);
    return `${prefix}<mark>${match}</mark>${suffix}`;
  }

  private workspaceKey(workspace?: string): string {
    return workspace ?? 'DEFAULT';
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
