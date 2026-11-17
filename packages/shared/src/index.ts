export interface TypeTreeNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  childCount: number;
  /** Number of individuals whose direct rdf:type is this class. */
  individualCount?: number;
  primaryParent?: string | null;
  /** Set on filtered trees: true when the label matched, false for ancestors kept for context. */
  matched?: boolean;
  children: TypeTreeNode[];
}

export type EntityType = 'class' | 'property' | 'individual';

export type SearchHighlightField = 'label' | 'alias' | 'comment';

export interface SearchHighlight {
  field: SearchHighlightField;
  snippet: string;
}

/** OWL flavour of a property; `undefined` for plain rdf:Property. */
export type PropertyKind = 'object' | 'datatype' | 'annotation';

/** How deprecated (owl:deprecated true) entities are treated by a search. */
export type DeprecatedFilter = 'include' | 'exclude' | 'only';

/** Metadata filters for `GET /search`. Values within one filter are OR-ed; filters are AND-ed. */
export interface SearchFilters {
  types?: EntityType[];
  /** rdfs:isDefinedBy targets (the ontology or module that defines the entity). */
  definedBy?: string[];
  /** IRI namespaces: the entity IRI up to and including its last `#` or `/`. */
  namespaces?: string[];
  propertyKinds?: PropertyKind[];
  /** Classes an individual is a direct rdf:type of. */
  instanceOf?: string[];
  deprecated?: DeprecatedFilter;
  /** Which text fields the query is matched against; all of them when empty. */
  fields?: SearchHighlightField[];
}

export type SearchFacetName = 'type' | 'definedBy' | 'namespace' | 'propertyKind' | 'instanceOf' | 'deprecated';

export interface SearchFacetValue {
  value: string;
  label: string;
  count: number;
}

/**
 * Counts per filter value for the current query. Each facet is counted with every
 * other filter applied but not its own, so the counts show what selecting a value adds.
 */
export type SearchFacets = Record<SearchFacetName, SearchFacetValue[]>;

export interface SearchHit {
  iri: string;
  type: EntityType;
  label: string;
  comment: string;
  score: number;
  highlights: SearchHighlight[];
  deprecated?: boolean;
  definedBy?: string[];
  propertyKind?: PropertyKind;
  instanceOf?: string[];
}

export interface SearchResponse {
  query: string;
  limit: number;
  offset: number;
  total: number;
  hits: SearchHit[];
  /** Present when the request asked for facets (`facets=true`). */
  facets?: SearchFacets;
}

export interface IndividualSummary {
  iri: string;
  label: string;
}

export interface IndividualsPage {
  class: string;
  total: number;
  limit: number;
  offset: number;
  items: IndividualSummary[];
}

export type DiagramRestrictionKind = 'some' | 'all' | 'hasValue' | 'min' | 'max' | 'exact';

/** `instanceOf` links an individual to its class; `assertion` links two individuals. */
export type DiagramEdgeKind = DiagramRestrictionKind | 'instanceOf' | 'assertion';

export type DiagramNodeKind = 'class' | 'individual';

export interface DiagramNode {
  id: string;
  iri: string;
  label: string;
  isCenter: boolean;
  kind: DiagramNodeKind;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  property: string;
  label?: string;
  kind: DiagramEdgeKind;
  cardinality?: number;
}

export interface DiagramResponse {
  center: string;
  radius: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  truncated: boolean;
}

export * from './language.js';

/** A language tag that occurs on labels or definitions in a workspace. */
export interface LanguageOption {
  /** Lower-cased BCP 47 tag, e.g. `en` or `sv`. */
  tag: string;
  /** Number of label/definition literals carrying this tag. */
  count: number;
}

export interface LanguagesResponse {
  /** The language used when none is chosen. */
  default: string;
  /** Tags found in the content, most used first; always includes `default`. */
  languages: LanguageOption[];
}
