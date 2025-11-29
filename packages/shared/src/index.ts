export interface TypeTreeNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  childCount: number;
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

export type DiagramRestrictionKind = 'some' | 'all' | 'hasValue' | 'min' | 'max' | 'exact';

export interface DiagramNode {
  id: string;
  iri: string;
  label: string;
  isCenter: boolean;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  property: string;
  label?: string;
  kind: DiagramRestrictionKind;
  cardinality?: number;
}

export interface DiagramResponse {
  center: string;
  radius: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  truncated: boolean;
}
