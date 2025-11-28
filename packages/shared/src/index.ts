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
