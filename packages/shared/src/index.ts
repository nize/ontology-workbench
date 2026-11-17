export interface TypeTreeNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  childCount: number;
  /** Number of individuals whose direct rdf:type is this class. */
  individualCount?: number;
  primaryParent?: string | null;
  children: TypeTreeNode[];
}

export type EntityType = 'class' | 'property' | 'individual';

export type SearchHighlightField = 'label' | 'alias' | 'comment';

export interface SearchHighlight {
  field: SearchHighlightField;
  snippet: string;
}

export interface SearchHit {
  iri: string;
  type: EntityType;
  label: string;
  comment: string;
  score: number;
  highlights: SearchHighlight[];
}

export interface SearchResponse {
  query: string;
  limit: number;
  offset: number;
  total: number;
  hits: SearchHit[];
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
