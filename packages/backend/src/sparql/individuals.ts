const SCHEMA_TYPES = [
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
  'http://www.w3.org/2002/07/owl#ObjectProperty',
  'http://www.w3.org/2002/07/owl#DatatypeProperty',
  'http://www.w3.org/2002/07/owl#AnnotationProperty',
  'http://www.w3.org/2002/07/owl#Restriction',
  'http://www.w3.org/2002/07/owl#Ontology'
];

/**
 * SPARQL filter that keeps `?variable` only when it is an IRI that is not
 * itself schema (a class, property, restriction or ontology header).
 * Must be placed inside the same GRAPH block as the pattern binding it.
 */
export function individualFilter(variable: string): string {
  const metaType = `?${variable}MetaType`;
  return `
      FILTER(isIRI(?${variable}))
      FILTER NOT EXISTS {
        ?${variable} a ${metaType} .
        VALUES ${metaType} { ${SCHEMA_TYPES.map((iri) => `<${iri}>`).join(' ')} }
      }
  `;
}

/** rdf:type values that say "this is an individual" without naming a class. */
export const NON_CLASS_TYPES = new Set([
  'http://www.w3.org/2002/07/owl#NamedIndividual',
  'http://www.w3.org/2000/01/rdf-schema#Resource'
]);
