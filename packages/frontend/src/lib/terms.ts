import type { EntityType, PropertyKind } from "@acme/shared"
import type { Restriction } from "../types/entity"

/**
 * Which wording the UI uses: everyday words, or the OWL vocabulary modelers know.
 * Every user-visible ontology term goes through this table so the two stay in sync.
 */
export type Vocabulary = "plain" | "owl"

export const DEFAULT_VOCABULARY: Vocabulary = "plain"

const TERMS = {
  class: { plain: "Type", owl: "Class" },
  property: { plain: "Property", owl: "Property" },
  individual: { plain: "Item", owl: "Individual" },
  individuals: { plain: "Items", owl: "Individuals" },
  subclasses: { plain: "More specific types", owl: "Subclasses" },
  superclasses: { plain: "Is a kind of", owl: "Superclasses" },
  subPropertyOf: { plain: "More specific version of", owl: "SubProperty Of" },
  domain: { plain: "Applies to", owl: "Domain" },
  range: { plain: "Value is", owl: "Range" },
  restrictions: { plain: "Rules", owl: "Direct Restrictions" },
  restriction: { plain: "Rule", owl: "Restriction" },
  types: { plain: "Is a", owl: "Types" },
  instanceOf: { plain: "Is a", owl: "Instance of" },
  propertyAssertion: { plain: "Relationship", owl: "Property assertion" },
  copyIri: { plain: "Copy identifier", owl: "Copy IRI" },
  // Search facets
  facetType: { plain: "Kind", owl: "Entity type" },
  facetPropertyKind: { plain: "Kind of property", owl: "Property kind" },
  facetInstanceOf: { plain: "Is a", owl: "Instance of class" },
  facetNamespace: { plain: "Source", owl: "Namespace" },
  facetDefinedBy: { plain: "Defined by", owl: "Defined by" },
  facetStatus: { plain: "Status", owl: "Status" },
} as const satisfies Record<string, Record<Vocabulary, string>>

export type TermKey = keyof typeof TERMS

export function term(key: TermKey, vocabulary: Vocabulary): string {
  return TERMS[key][vocabulary]
}

const PROPERTY_KINDS: Record<PropertyKind, Record<Vocabulary, string>> = {
  object: { plain: "Relationship", owl: "Object property" },
  datatype: { plain: "Attribute", owl: "Datatype property" },
  annotation: { plain: "Note field", owl: "Annotation property" },
}

export function propertyKindLabel(kind: string, vocabulary: Vocabulary): string {
  return PROPERTY_KINDS[kind as PropertyKind]?.[vocabulary] ?? kind
}

export function entityTypeLabel(type: string, vocabulary: Vocabulary, propertyKind?: string): string {
  if (type === "property" && propertyKind) return propertyKindLabel(propertyKind, vocabulary)
  if (type === "class" || type === "property" || type === "individual") {
    return term(type as EntityType, vocabulary)
  }
  return type
}

const XSD = "http://www.w3.org/2001/XMLSchema#"
const PLAIN_DATATYPES: Record<string, string> = {
  string: "text",
  normalizedString: "text",
  langString: "text",
  anyURI: "web address",
  boolean: "yes/no",
  integer: "whole number",
  int: "whole number",
  long: "whole number",
  short: "whole number",
  nonNegativeInteger: "whole number",
  positiveInteger: "whole number",
  decimal: "number",
  double: "number",
  float: "number",
  date: "date",
  dateTime: "date and time",
  time: "time",
}

/** Everyday name for an XSD/RDF datatype IRI, or undefined if it isn't a well-known one. */
export function plainDatatype(iri: string): string | undefined {
  const local = iri.split(/[#/]/).pop() ?? ""
  const known = iri.startsWith(XSD) || iri.endsWith("#langString") || iri.endsWith("#PlainLiteral")
  return known ? PLAIN_DATATYPES[local] ?? (local === "PlainLiteral" ? "text" : undefined) : undefined
}

/** OWL/RDF/RDFS built-ins (owl:Class, owl:NamedIndividual, …): meaningful to modelers, noise to everyone else. */
export function isBuiltInVocabulary(iri: string): boolean {
  return (
    iri.startsWith("http://www.w3.org/2002/07/owl#") ||
    iri.startsWith("http://www.w3.org/1999/02/22-rdf-syntax-ns#") ||
    iri.startsWith("http://www.w3.org/2000/01/rdf-schema#")
  )
}

/** Plain-language quantifier shown before a restriction's target, e.g. "at least 2". */
export function restrictionQualifier(restriction: Restriction): string {
  switch (restriction.kind) {
    case "some":
      return "at least one"
    case "all":
      return "only"
    case "hasValue":
      return "always"
    case "min":
      return `at least ${restriction.cardinality}`
    case "max":
      return `at most ${restriction.cardinality}`
    case "exact":
      return `exactly ${restriction.cardinality}`
  }
}
