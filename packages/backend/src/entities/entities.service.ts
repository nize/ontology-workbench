import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { GraphStoreService } from '../sparql/graphStore.service.js';
import type { SparqlBinding, SparqlParams, SparqlRow } from '../sparql/graphStore.js';

export type EntityType = 'class' | 'property' | 'individual';

export interface LiteralValue {
  value: string;
  language?: string;
  datatype?: string;
}

export interface RestrictionTarget {
  type: 'iri' | 'datatype';
  value: string;
}

export interface RestrictionValue {
  type: 'iri' | 'literal';
  value: string;
  language?: string;
  datatype?: string;
}

export type Restriction =
  | {
      kind: 'some' | 'all';
      property: string;
      target: RestrictionValue;
    }
  | {
      kind: 'hasValue';
      property: string;
      value: RestrictionValue;
    }
  | {
      kind: 'min' | 'max' | 'exact';
      property: string;
      cardinality: number;
      target?: RestrictionTarget;
    };

export interface EntityDetails {
  iri: string;
  type: EntityType;
  labels: LiteralValue[];
  aliases: LiteralValue[];
  comment: LiteralValue;
  superclasses: string[];
  restrictions: Restriction[];
  domain: string[];
  range: string[];
  subPropertyOf: string[];
  types: string[];
}

const TYPE_QUERY = `
  SELECT DISTINCT ?type
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} a ?type .
    }
  }
`;

const ANNOTATIONS_QUERY = `
  SELECT ?predicate ?value
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} ?predicate ?value .
      FILTER(isLiteral(?value))
    }
  }
`;

const CLASS_SUPERCLASS_QUERY = `
  SELECT DISTINCT ?superclass
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?superclass .
    }
  }
`;

const CLASS_RESTRICTIONS_QUERY = `
  SELECT ?restriction ?predicate ?object
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?restriction .
      ?restriction a <http://www.w3.org/2002/07/owl#Restriction> .
      ?restriction ?predicate ?object .
    }
    FILTER(?predicate != <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>)
  }
`;

const PROPERTY_DOMAIN_QUERY = `
  SELECT DISTINCT ?domain
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} <http://www.w3.org/2000/01/rdf-schema#domain> ?domain .
      FILTER(isIRI(?domain))
    }
  }
`;

const PROPERTY_RANGE_QUERY = `
  SELECT DISTINCT ?range
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} <http://www.w3.org/2000/01/rdf-schema#range> ?range .
      FILTER(isIRI(?range))
    }
  }
`;

const PROPERTY_SUPERPROPERTY_QUERY = `
  SELECT DISTINCT ?super
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> ?super .
      FILTER(isIRI(?super))
    }
  }
`;

const INDIVIDUAL_TYPES_QUERY = `
  SELECT DISTINCT ?type
  WHERE {
    GRAPH {{workspace}} {
      {{entity}} a ?type .
      FILTER(isIRI(?type))
    }
  }
`;

const CLASS_TYPE_IRIS = new Set([
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class'
]);

const PROPERTY_TYPE_IRIS = new Set([
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
  'http://www.w3.org/2002/07/owl#ObjectProperty',
  'http://www.w3.org/2002/07/owl#DatatypeProperty',
  'http://www.w3.org/2002/07/owl#AnnotationProperty',
  'http://www.w3.org/2002/07/owl#FunctionalProperty'
]);

const OWL_ON_PROPERTY_IRI = 'http://www.w3.org/2002/07/owl#onProperty';
const OWL_SOME_VALUES_FROM_IRI = 'http://www.w3.org/2002/07/owl#someValuesFrom';
const OWL_ALL_VALUES_FROM_IRI = 'http://www.w3.org/2002/07/owl#allValuesFrom';
const OWL_HAS_VALUE_IRI = 'http://www.w3.org/2002/07/owl#hasValue';
const OWL_MIN_QUALIFIED_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#minQualifiedCardinality';
const OWL_MIN_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#minCardinality';
const OWL_MAX_QUALIFIED_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#maxQualifiedCardinality';
const OWL_MAX_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#maxCardinality';
const OWL_QUALIFIED_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#qualifiedCardinality';
const OWL_CARDINALITY_IRI = 'http://www.w3.org/2002/07/owl#cardinality';
const OWL_ON_CLASS_IRI = 'http://www.w3.org/2002/07/owl#onClass';
const OWL_ON_DATA_RANGE_IRI = 'http://www.w3.org/2002/07/owl#onDataRange';

function literalKey(literal: LiteralValue): string {
  return `${literal.value}|${literal.language ?? ''}|${literal.datatype ?? ''}`;
}

function sortLiterals(values: LiteralValue[]): LiteralValue[] {
  return [...values].sort((a, b) => {
    if (a.value !== b.value) {
      return a.value.localeCompare(b.value);
    }
    const langA = a.language ?? '';
    const langB = b.language ?? '';
    if (langA !== langB) {
      return langA.localeCompare(langB);
    }
    const dtA = a.datatype ?? '';
    const dtB = b.datatype ?? '';
    return dtA.localeCompare(dtB);
  });
}

function toLiteral(binding: SparqlBinding): LiteralValue {
  return {
    value: binding.value,
    language: binding.language,
    datatype: binding.datatype
  };
}

function toRestrictionValue(binding: SparqlBinding): RestrictionValue {
  if (binding.type === 'iri') {
    return { type: 'iri', value: binding.value };
  }
  return {
    type: 'literal',
    value: binding.value,
    language: binding.language,
    datatype: binding.datatype
  };
}

function toRestrictionTarget(binding: SparqlBinding): RestrictionTarget | undefined {
  if (binding.type !== 'iri') {
    return undefined;
  }
  return { type: 'iri', value: binding.value };
}

function parseCardinality(binding?: SparqlBinding): number | undefined {
  if (!binding || binding.type !== 'literal') {
    return undefined;
  }
  const parsed = Number.parseInt(binding.value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

@Injectable()
export class EntitiesService {
  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  async getEntityDetails(iri: string, workspace?: string): Promise<EntityDetails> {
    const params: SparqlParams = {
      entity: { type: 'iri', value: iri }
    };

    const typeRows = await this.graphStore.select(TYPE_QUERY, params, workspace);
    if (typeRows.length === 0) {
      throw new NotFoundException(`Entity not found: ${iri}`);
    }

    const typeIris = new Set(typeRows.map((row) => row.type?.value).filter(Boolean) as string[]);
    const entityType = this.resolveEntityType(typeIris);

    const [annotations, superclasses, restrictions, domain, range, superproperties, individualTypes] =
      await Promise.all([
        this.graphStore.select(ANNOTATIONS_QUERY, params, workspace),
        entityType === 'class'
          ? this.graphStore.select(CLASS_SUPERCLASS_QUERY, params, workspace)
          : Promise.resolve([]),
        entityType === 'class'
          ? this.graphStore.select(CLASS_RESTRICTIONS_QUERY, params, workspace)
          : Promise.resolve([]),
        entityType === 'property'
          ? this.graphStore.select(PROPERTY_DOMAIN_QUERY, params, workspace)
          : Promise.resolve([]),
        entityType === 'property'
          ? this.graphStore.select(PROPERTY_RANGE_QUERY, params, workspace)
          : Promise.resolve([]),
        entityType === 'property'
          ? this.graphStore.select(PROPERTY_SUPERPROPERTY_QUERY, params, workspace)
          : Promise.resolve([]),
        entityType === 'individual'
          ? this.graphStore.select(INDIVIDUAL_TYPES_QUERY, params, workspace)
          : Promise.resolve([])
      ]);

    const { labels, aliases, comment } = this.normalizeAnnotations(annotations);
    const superIris = this.normalizeIriSet(superclasses, 'superclass');
    const restrictionList = this.normalizeRestrictions(restrictions);
    const domainIris = this.normalizeIriSet(domain, 'domain');
    const rangeIris = this.normalizeIriSet(range, 'range');
    const superPropertyIris = this.normalizeIriSet(superproperties, 'super');
    const individualTypeIris = this.normalizeIriSet(individualTypes, 'type');

    return {
      iri,
      type: entityType,
      labels,
      aliases,
      comment,
      superclasses: superIris,
      restrictions: restrictionList,
      domain: domainIris,
      range: rangeIris,
      subPropertyOf: superPropertyIris,
      types: entityType === 'individual' ? individualTypeIris : Array.from(typeIris).sort()
    };
  }

  private resolveEntityType(typeIris: Set<string>): EntityType {
    for (const iri of typeIris) {
      if (CLASS_TYPE_IRIS.has(iri)) {
        return 'class';
      }
    }
    for (const iri of typeIris) {
      if (PROPERTY_TYPE_IRIS.has(iri)) {
        return 'property';
      }
    }
    return 'individual';
  }

  private normalizeAnnotations(rows: SparqlRow[]): {
    labels: LiteralValue[];
    aliases: LiteralValue[];
    comment: LiteralValue;
  } {
    const labelPredicates = new Set([
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2004/02/skos/core#prefLabel'
    ]);
    const aliasPredicates = new Set([
      'http://www.w3.org/2004/02/skos/core#altLabel',
      'http://www.w3.org/2004/02/skos/core#hiddenLabel'
    ]);
    const commentPredicates = new Set([
      'http://www.w3.org/2000/01/rdf-schema#comment',
      'http://www.w3.org/2004/02/skos/core#definition'
    ]);

    const labels: LiteralValue[] = [];
    const aliases: LiteralValue[] = [];
    const comments: LiteralValue[] = [];
    const seenLabels = new Set<string>();
    const seenAliases = new Set<string>();

    for (const row of rows) {
      const predicate = row.predicate?.value;
      const valueBinding = row.value;
      if (!predicate || !valueBinding) {
        continue;
      }
      const literal = toLiteral(valueBinding);
      if (labelPredicates.has(predicate)) {
        const key = literalKey(literal);
        if (!seenLabels.has(key)) {
          seenLabels.add(key);
          labels.push(literal);
        }
        continue;
      }
      if (aliasPredicates.has(predicate)) {
        const key = literalKey(literal);
        if (!seenAliases.has(key)) {
          seenAliases.add(key);
          aliases.push(literal);
        }
        continue;
      }
      if (commentPredicates.has(predicate)) {
        comments.push(literal);
      }
    }

    const comment = this.pickBestComment(comments);

    return {
      labels: sortLiterals(labels),
      aliases: sortLiterals(aliases),
      comment
    };
  }

  private pickBestComment(comments: LiteralValue[]): LiteralValue {
    if (comments.length === 0) {
      return { value: '' };
    }
    const preferred = comments.find((item) => item.language === 'en') ?? comments[0]!;
    return preferred;
  }

  private normalizeIriSet(rows: SparqlRow[], key: keyof SparqlRow): string[] {
    const iris = new Set<string>();
    for (const row of rows) {
      const binding = row[key];
      if (binding?.type === 'iri' && !binding.value.startsWith('urn:blank:')) {
        iris.add(binding.value);
      }
    }
    return Array.from(iris).sort();
  }

  private normalizeRestrictions(rows: SparqlRow[]): Restriction[] {
    const byRestriction = new Map<string, RestrictionBuilder>();

    for (const row of rows) {
      const restrictionId = row.restriction?.value;
      const predicate = row.predicate;
      const object = row.object;
      if (!restrictionId || predicate?.type !== 'iri' || !object) {
        continue;
      }
      const builder = byRestriction.get(restrictionId) ?? {
        property: undefined,
        some: undefined,
        all: undefined,
        hasValue: undefined,
        minQualified: undefined,
        min: undefined,
        maxQualified: undefined,
        max: undefined,
        exactQualified: undefined,
        exact: undefined,
        onClass: undefined,
        onDataRange: undefined
      };

      switch (predicate.value) {
        case OWL_ON_PROPERTY_IRI: {
          if (object.type === 'iri') {
            builder.property = object.value;
          }
          break;
        }
        case OWL_SOME_VALUES_FROM_IRI: {
          builder.some = toRestrictionValue(object);
          break;
        }
        case OWL_ALL_VALUES_FROM_IRI: {
          builder.all = toRestrictionValue(object);
          break;
        }
        case OWL_HAS_VALUE_IRI: {
          builder.hasValue = toRestrictionValue(object);
          break;
        }
        case OWL_MIN_QUALIFIED_CARDINALITY_IRI: {
          builder.minQualified ??= parseCardinality(object);
          break;
        }
        case OWL_MIN_CARDINALITY_IRI: {
          builder.min ??= parseCardinality(object);
          break;
        }
        case OWL_MAX_QUALIFIED_CARDINALITY_IRI: {
          builder.maxQualified ??= parseCardinality(object);
          break;
        }
        case OWL_MAX_CARDINALITY_IRI: {
          builder.max ??= parseCardinality(object);
          break;
        }
        case OWL_QUALIFIED_CARDINALITY_IRI: {
          builder.exactQualified ??= parseCardinality(object);
          break;
        }
        case OWL_CARDINALITY_IRI: {
          builder.exact ??= parseCardinality(object);
          break;
        }
        case OWL_ON_CLASS_IRI: {
          if (object.type === 'iri') {
            builder.onClass = object.value;
          }
          break;
        }
        case OWL_ON_DATA_RANGE_IRI: {
          if (object.type === 'iri') {
            builder.onDataRange = object.value;
          }
          break;
        }
        default:
          break;
      }

      byRestriction.set(restrictionId, builder);
    }

    const results: Restriction[] = [];

    for (const builder of byRestriction.values()) {
      const { property } = builder;
      if (!property) {
        continue;
      }
      if (builder.some) {
        results.push({ kind: 'some', property, target: builder.some });
      }
      if (builder.all) {
        results.push({ kind: 'all', property, target: builder.all });
      }
      if (builder.hasValue) {
        results.push({ kind: 'hasValue', property, value: builder.hasValue });
      }

      const qualifier = builder.onClass
        ? ({ type: 'iri', value: builder.onClass } satisfies RestrictionTarget)
        : builder.onDataRange
          ? ({ type: 'datatype', value: builder.onDataRange } satisfies RestrictionTarget)
          : undefined;

      const minCardinality = builder.minQualified ?? builder.min;
      if (typeof minCardinality === 'number') {
        results.push(
          qualifier
            ? { kind: 'min', property, cardinality: minCardinality, target: qualifier }
            : { kind: 'min', property, cardinality: minCardinality }
        );
      }

      const maxCardinality = builder.maxQualified ?? builder.max;
      if (typeof maxCardinality === 'number') {
        results.push(
          qualifier
            ? { kind: 'max', property, cardinality: maxCardinality, target: qualifier }
            : { kind: 'max', property, cardinality: maxCardinality }
        );
      }

      const exactCardinality = builder.exactQualified ?? builder.exact;
      if (typeof exactCardinality === 'number') {
        results.push(
          qualifier
            ? { kind: 'exact', property, cardinality: exactCardinality, target: qualifier }
            : { kind: 'exact', property, cardinality: exactCardinality }
        );
      }
    }

    return results.sort(restrictionSorter);
  }
}

type RestrictionBuilder = {
  property: string | undefined;
  some: RestrictionValue | undefined;
  all: RestrictionValue | undefined;
  hasValue: RestrictionValue | undefined;
  minQualified: number | undefined;
  min: number | undefined;
  maxQualified: number | undefined;
  max: number | undefined;
  exactQualified: number | undefined;
  exact: number | undefined;
  onClass: string | undefined;
  onDataRange: string | undefined;
};

function restrictionSorter(a: Restriction, b: Restriction): number {
  if (a.property !== b.property) {
    return a.property.localeCompare(b.property);
  }
  const kindOrder: Record<Restriction['kind'], number> = {
    all: 0,
    some: 1,
    hasValue: 2,
    min: 3,
    max: 4,
    exact: 5
  };
  const orderA = kindOrder[a.kind];
  const orderB = kindOrder[b.kind];
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  if ('cardinality' in a && 'cardinality' in b) {
    return a.cardinality - b.cardinality;
  }
  if ('target' in a && 'target' in b) {
    return compareRestrictionTargets(a.target, b.target);
  }
  if ('target' in a && !('target' in b)) {
    return -1;
  }
  if (!('target' in a) && 'target' in b) {
    return 1;
  }
  return 0;
}

function compareRestrictionTargets(
  a: RestrictionTarget | RestrictionValue | undefined,
  b: RestrictionTarget | RestrictionValue | undefined
): number {
  if (!a || !b) {
    return 0;
  }
  const valueA = 'value' in a ? a.value : '';
  const valueB = 'value' in b ? b.value : '';
  if (valueA !== valueB) {
    return valueA.localeCompare(valueB);
  }
  const typeA = 'type' in a ? a.type : '';
  const typeB = 'type' in b ? b.type : '';
  return typeA.localeCompare(typeB);
}
