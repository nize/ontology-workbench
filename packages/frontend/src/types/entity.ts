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
