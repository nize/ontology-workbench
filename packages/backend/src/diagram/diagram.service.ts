import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  DEFAULT_LANGUAGE,
  DiagramEdge,
  DiagramEdgeKind,
  DiagramNode,
  DiagramNodeKind,
  DiagramResponse,
  pickByLanguage
} from '@acme/shared';

import { EntitiesService, Restriction } from '../entities/entities.service.js';
import { GraphStoreService } from '../sparql/graphStore.service.js';
import { individualFilter, NON_CLASS_TYPES } from '../sparql/individuals.js';

export const DIAGRAM_MAX_EDGES = 'DIAGRAM_MAX_EDGES';
const DEFAULT_MAX_EDGES = 50;
export const DIAGRAM_MAX_INDIVIDUALS_PER_CLASS = 'DIAGRAM_MAX_INDIVIDUALS_PER_CLASS';
const DEFAULT_MAX_INDIVIDUALS_PER_CLASS = 10;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const INSTANCE_OF_LABEL = 'instance of';

// Predicates linking two resources that are bookkeeping rather than relations.
const ASSERTION_EXCLUDED_PREDICATES = [
  RDF_TYPE,
  'http://www.w3.org/2000/01/rdf-schema#isDefinedBy',
  'http://www.w3.org/2000/01/rdf-schema#seeAlso'
];
const ASSERTION_PREDICATE_FILTER =
  `FILTER(?property NOT IN (${ASSERTION_EXCLUDED_PREDICATES.map((iri) => `<${iri}>`).join(', ')}))`;

const CLASS_INSTANCES_QUERY = `
  SELECT DISTINCT ?ind
  WHERE {
    {{graphStart}}
      ?ind a {{entity}} .
      ${individualFilter('ind')}
    {{graphEnd}}
  }
  ORDER BY ?ind
  LIMIT {{limit}}
`;

const OUTGOING_ASSERTIONS_QUERY = `
  SELECT DISTINCT ?property ?target
  WHERE {
    {{graphStart}}
      {{entity}} ?property ?target .
      ${ASSERTION_PREDICATE_FILTER}
      ${individualFilter('target')}
    {{graphEnd}}
  }
`;

const INCOMING_ASSERTIONS_QUERY = `
  SELECT DISTINCT ?source ?property
  WHERE {
    {{graphStart}}
      ?source ?property {{entity}} .
      ${ASSERTION_PREDICATE_FILTER}
      ${individualFilter('source')}
    {{graphEnd}}
  }
`;

const LABEL_QUERY = `
  SELECT ?label
  WHERE {
    {{graphStart}}
      {{entity}} {{predicate}} ?label .
    {{graphEnd}}
  }
`;

const INCOMING_RESTRICTIONS_QUERY = `
  SELECT DISTINCT ?source ?property ?kind ?cardinality
  WHERE {
    {{graphStart}}
      ?source <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?restriction .
      ?restriction a <http://www.w3.org/2002/07/owl#Restriction> ;
                   <http://www.w3.org/2002/07/owl#onProperty> ?property .
      {
        ?restriction <http://www.w3.org/2002/07/owl#someValuesFrom> {{entity}} .
        BIND("some" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#allValuesFrom> {{entity}} .
        BIND("all" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#hasValue> {{entity}} .
        BIND("hasValue" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#minQualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onClass> {{entity}} .
        BIND("min" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#maxQualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onClass> {{entity}} .
        BIND("max" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#qualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onClass> {{entity}} .
        BIND("exact" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#minQualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onDataRange> {{entity}} .
        BIND("min" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#maxQualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onDataRange> {{entity}} .
        BIND("max" AS ?kind)
      }
      UNION
      {
        ?restriction <http://www.w3.org/2002/07/owl#qualifiedCardinality> ?cardinality ;
                     <http://www.w3.org/2002/07/owl#onDataRange> {{entity}} .
        BIND("exact" AS ?kind)
      }
    {{graphEnd}}
    FILTER(isIRI(?source))
  }
`;

const LABEL_PREDICATES = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2004/02/skos/core#prefLabel'
];

@Injectable()
export class DiagramService {
  constructor(
    @Inject(EntitiesService) private readonly entities: EntitiesService,
    @Inject(GraphStoreService) private readonly graphStore: GraphStoreService,
    @Inject(DIAGRAM_MAX_EDGES) private readonly maxEdges: number = DEFAULT_MAX_EDGES,
    @Inject(DIAGRAM_MAX_INDIVIDUALS_PER_CLASS)
    private readonly maxIndividualsPerClass: number = DEFAULT_MAX_INDIVIDUALS_PER_CLASS
  ) {}

  async getDiagram(
    center: string,
    radius: number,
    workspace?: string,
    lang = DEFAULT_LANGUAGE
  ): Promise<DiagramResponse> {
    const maxRadius = 2;
    const safeRadius = Math.min(Math.max(1, radius), maxRadius);

    const visited = new Set<string>();
    const queue: { iri: string; depth: number }[] = [{ iri: center, depth: 0 }];
    const collectedEdges: InternalEdge[] = [];
    const collectedEdgeKeys = new Set<string>();
    const nodeIris = new Set<string>([center]);
    const nodeKinds = new Map<string, DiagramNodeKind>();
    let individualsTruncated = false;

    // A punned IRI (both class and individual) is drawn as a class.
    const markKind = (iri: string, kind: DiagramNodeKind) => {
      if (kind === 'class' || !nodeKinds.has(iri)) {
        nodeKinds.set(iri, kind);
      }
    };

    while (queue.length > 0) {
      const { iri, depth } = queue.shift()!;
      if (visited.has(iri)) continue;
      visited.add(iri);

      if (depth >= safeRadius) continue;

      try {
        const details = await this.entities.getEntityDetails(iri, workspace);
        let edges: InternalEdge[];

        if (details.type === 'class') {
          markKind(iri, 'class');
          const outgoingEdges = this.restrictionsToEdges(iri, details.restrictions);
          const incomingEdges = await this.fetchIncomingRestrictionEdges(iri, workspace);
          const instances = await this.fetchInstanceEdges(iri, workspace);
          individualsTruncated ||= instances.truncated;
          edges = [...outgoingEdges, ...incomingEdges, ...instances.edges];
        } else if (details.type === 'individual') {
          markKind(iri, 'individual');
          edges = [
            ...this.typesToEdges(iri, details.types),
            ...(await this.fetchAssertionEdges(iri, workspace))
          ];
        } else {
          continue;
        }

        for (const edge of edges) {
          const edgeKey = this.internalEdgeKey(edge);
          if (collectedEdgeKeys.has(edgeKey)) {
            continue;
          }

          collectedEdgeKeys.add(edgeKey);
          collectedEdges.push(edge);

          nodeIris.add(edge.source);
          nodeIris.add(edge.targetIri);
          markKind(edge.source, edge.sourceKind);
          markKind(edge.targetIri, edge.targetKind);

          const neighbor = edge.source === iri ? edge.targetIri : edge.source;
          if (neighbor !== iri && !visited.has(neighbor)) {
            queue.push({ iri: neighbor, depth: depth + 1 });
          }
        }
      } catch (error) {
        // A missing neighbor is skipped; a missing center is an error.
        if (iri === center) {
          throw error;
        }
      }
    }

    const truncated = collectedEdges.length > this.maxEdges || individualsTruncated;
    const limitedEdges = collectedEdges.slice(0, this.maxEdges);

    // Rebuild nodeIris to only include nodes that are part of the limited edges (plus the center)
    // This ensures we don't return disconnected nodes if we truncated the graph
    const finalNodeIris = new Set<string>([center]);
    const propertyIris = new Set<string>();
    
    for (const edge of limitedEdges) {
      finalNodeIris.add(edge.source);
      finalNodeIris.add(edge.targetIri);
      if (edge.kind !== 'instanceOf') {
        propertyIris.add(edge.property);
      }
    }

    const labels = await this.fetchLabels([...Array.from(finalNodeIris), ...Array.from(propertyIris)], workspace, lang);

    const nodes: DiagramNode[] = Array.from(finalNodeIris).map((iri) => ({
      id: this.stableId(['node', iri]),
      iri,
      label: labels.get(iri) ?? this.iriFragment(iri),
      isCenter: iri === center,
      kind: nodeKinds.get(iri) ?? 'class'
    }));

    const nodeIdByIri = new Map(nodes.map((node) => [node.iri, node.id] as const));

    const responseEdges: DiagramEdge[] = limitedEdges.map((edge) => ({
      id: this.stableId(['edge', edge.source, edge.property, edge.targetIri, edge.kind, edge.cardinality ?? '']),
      source: nodeIdByIri.get(edge.source) ?? this.stableId(['node', edge.source]),
      target: nodeIdByIri.get(edge.targetIri) ?? this.stableId(['node', edge.targetIri]),
      property: edge.property,
      label: edge.kind === 'instanceOf'
        ? INSTANCE_OF_LABEL
        : labels.get(edge.property) ?? this.iriFragment(edge.property),
      kind: edge.kind,
      cardinality: edge.cardinality
    }));

    return {
      center,
      radius: safeRadius,
      nodes,
      edges: responseEdges,
      truncated
    };
  }

  private restrictionsToEdges(center: string, restrictions: Restriction[]): InternalEdge[] {
    const edges: InternalEdge[] = [];
    for (const restriction of restrictions) {
      const target = this.restrictionTargetIri(restriction);
      if (!target) {
        continue;
      }
      const cardinality = 'cardinality' in restriction ? restriction.cardinality : undefined;
      edges.push({
        source: center,
        targetIri: target,
        property: restriction.property,
        kind: restriction.kind,
        cardinality,
        sourceKind: 'class',
        // owl:hasValue names an individual; every other restriction names a class or datatype.
        targetKind: restriction.kind === 'hasValue' ? 'individual' : 'class'
      });
    }
    return edges;
  }

  private async fetchIncomingRestrictionEdges(targetIri: string, workspace?: string): Promise<InternalEdge[]> {
    const rows = await this.graphStore.select(
      this.prepareQuery(INCOMING_RESTRICTIONS_QUERY, workspace),
      { entity: { type: 'iri', value: targetIri } },
      workspace
    );

    const edges: InternalEdge[] = [];
    for (const row of rows) {
      const source = row.source?.type === 'iri' ? row.source.value : undefined;
      const property = row.property?.type === 'iri' ? row.property.value : undefined;
      const kindValue = row.kind?.type === 'literal' ? row.kind.value : undefined;

      if (!source || !property || !this.isRestrictionKind(kindValue)) {
        continue;
      }

      const rawCardinality = row.cardinality?.type === 'literal'
        ? Number.parseInt(row.cardinality.value, 10)
        : undefined;

      edges.push({
        source,
        targetIri,
        property,
        kind: kindValue,
        cardinality: rawCardinality !== undefined && !Number.isNaN(rawCardinality) ? rawCardinality : undefined,
        sourceKind: 'class',
        targetKind: kindValue === 'hasValue' ? 'individual' : 'class'
      });
    }

    return edges;
  }

  private async fetchInstanceEdges(
    classIri: string,
    workspace?: string
  ): Promise<{ edges: InternalEdge[]; truncated: boolean }> {
    const rows = await this.graphStore.select(
      this.prepareQuery(CLASS_INSTANCES_QUERY, workspace),
      { entity: { type: 'iri', value: classIri }, limit: this.maxIndividualsPerClass + 1 },
      workspace
    );
    const individuals = rows
      .map((row) => (row.ind?.type === 'iri' ? row.ind.value : undefined))
      .filter((iri): iri is string => !!iri && !iri.startsWith('urn:blank:'));

    return {
      truncated: individuals.length > this.maxIndividualsPerClass,
      edges: individuals.slice(0, this.maxIndividualsPerClass).map((individual) => ({
        source: individual,
        targetIri: classIri,
        property: RDF_TYPE,
        kind: 'instanceOf',
        sourceKind: 'individual',
        targetKind: 'class'
      }))
    };
  }

  private typesToEdges(individual: string, types: string[]): InternalEdge[] {
    return types
      .filter((type) => !NON_CLASS_TYPES.has(type))
      .map((type) => ({
        source: individual,
        targetIri: type,
        property: RDF_TYPE,
        kind: 'instanceOf',
        sourceKind: 'individual',
        targetKind: 'class'
      }));
  }

  private async fetchAssertionEdges(individual: string, workspace?: string): Promise<InternalEdge[]> {
    const params = { entity: { type: 'iri', value: individual } } as const;
    const [outgoing, incoming] = await Promise.all([
      this.graphStore.select(this.prepareQuery(OUTGOING_ASSERTIONS_QUERY, workspace), params, workspace),
      this.graphStore.select(this.prepareQuery(INCOMING_ASSERTIONS_QUERY, workspace), params, workspace)
    ]);

    const edges: InternalEdge[] = [];
    for (const row of outgoing) {
      const property = row.property?.type === 'iri' ? row.property.value : undefined;
      const target = row.target?.type === 'iri' ? row.target.value : undefined;
      if (property && target && target !== individual) {
        edges.push({
          source: individual,
          targetIri: target,
          property,
          kind: 'assertion',
          sourceKind: 'individual',
          targetKind: 'individual'
        });
      }
    }
    for (const row of incoming) {
      const property = row.property?.type === 'iri' ? row.property.value : undefined;
      const source = row.source?.type === 'iri' ? row.source.value : undefined;
      if (property && source && source !== individual) {
        edges.push({
          source,
          targetIri: individual,
          property,
          kind: 'assertion',
          sourceKind: 'individual',
          targetKind: 'individual'
        });
      }
    }
    return edges;
  }

  private isRestrictionKind(kindValue?: string): kindValue is Restriction['kind'] {
    return (
      kindValue === 'some'
      || kindValue === 'all'
      || kindValue === 'hasValue'
      || kindValue === 'min'
      || kindValue === 'max'
      || kindValue === 'exact'
    );
  }

  private internalEdgeKey(edge: InternalEdge): string {
    return `${edge.source}|${edge.property}|${edge.targetIri}|${edge.kind}|${edge.cardinality ?? ''}`;
  }

  private restrictionTargetIri(restriction: Restriction): string | undefined {
    switch (restriction.kind) {
      case 'some':
      case 'all':
        return restriction.target.type === 'iri' ? restriction.target.value : undefined;
      case 'hasValue':
        return restriction.value.type === 'iri' ? restriction.value.value : undefined;
      case 'min':
      case 'max':
      case 'exact':
        return restriction.target?.type === 'iri' ? restriction.target.value : undefined;
      default:
        return undefined;
    }
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

  private async fetchLabels(iris: string[], workspace: string | undefined, lang: string): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    for (const iri of iris) {
      const literals: Array<{ value: string; language?: string }> = [];
      for (const predicate of LABEL_PREDICATES) {
        const rows = await this.graphStore.select(
          this.prepareQuery(LABEL_QUERY, workspace),
          { entity: { type: 'iri', value: iri }, predicate: { type: 'iri', value: predicate } },
          workspace
        );
        for (const row of rows) {
          if (row.label?.type === 'literal') {
            literals.push({ value: row.label.value, language: row.label.language });
          }
        }
      }
      const best = pickByLanguage(literals, lang);
      if (best) {
        labels.set(iri, best.value);
      }
    }
    return labels;
  }

  private iriFragment(iri: string): string {
    const parts = iri.split(/[#\/]/);
    return parts[parts.length - 1] || iri;
  }

  private stableId(parts: Array<string | number>): string {
    const hash = createHash('sha256');
    for (const part of parts) {
      hash.update(String(part));
      hash.update('|');
    }
    return hash.digest('hex').slice(0, 16);
  }
}

type InternalEdge = {
  source: string;
  targetIri: string;
  property: string;
  kind: DiagramEdgeKind;
  cardinality?: number;
  sourceKind: DiagramNodeKind;
  targetKind: DiagramNodeKind;
};
