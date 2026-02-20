import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { DiagramEdge, DiagramNode, DiagramResponse } from '@acme/shared';

import { EntitiesService, Restriction } from '../entities/entities.service.js';
import { GraphStoreService } from '../sparql/graphStore.service.js';

export const DIAGRAM_MAX_EDGES = 'DIAGRAM_MAX_EDGES';
const DEFAULT_MAX_EDGES = 50;

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
    @Inject(DIAGRAM_MAX_EDGES) private readonly maxEdges: number = DEFAULT_MAX_EDGES
  ) {}

  async getDiagram(center: string, radius: number, workspace?: string): Promise<DiagramResponse> {
    const maxRadius = 2;
    const safeRadius = Math.min(Math.max(1, radius), maxRadius);

    const visited = new Set<string>();
    const queue: { iri: string; depth: number }[] = [{ iri: center, depth: 0 }];
    const collectedEdges: InternalEdge[] = [];
    const collectedEdgeKeys = new Set<string>();
    const nodeIris = new Set<string>([center]);

    while (queue.length > 0) {
      const { iri, depth } = queue.shift()!;
      if (visited.has(iri)) continue;
      visited.add(iri);

      if (depth >= safeRadius) continue;

      try {
        const details = await this.entities.getEntityDetails(iri, workspace);
        if (details.type !== 'class') {
          continue;
        }

        const outgoingEdges = this.restrictionsToEdges(iri, details.restrictions);
        const incomingEdges = await this.fetchIncomingRestrictionEdges(iri, workspace);

        for (const edge of [...outgoingEdges, ...incomingEdges]) {
          const edgeKey = this.internalEdgeKey(edge);
          if (collectedEdgeKeys.has(edgeKey)) {
            continue;
          }

          collectedEdgeKeys.add(edgeKey);
          collectedEdges.push(edge);

          nodeIris.add(edge.source);
          nodeIris.add(edge.targetIri);

          const neighbor = edge.source === iri ? edge.targetIri : edge.source;
          if (neighbor !== iri && !visited.has(neighbor)) {
            queue.push({ iri: neighbor, depth: depth + 1 });
          }
        }
      } catch (error) {
        // If the center node is missing, we can't do much, but for others we just skip
        if (iri === center) {
           // If center is missing, we might want to return a partial response or rethrow
           // But let's try to handle it gracefully if possible, or let it fail if it's the center
           throw error;
        }
      }
    }

    const truncated = collectedEdges.length > this.maxEdges;
    const limitedEdges = collectedEdges.slice(0, this.maxEdges);

    // Rebuild nodeIris to only include nodes that are part of the limited edges (plus the center)
    // This ensures we don't return disconnected nodes if we truncated the graph
    const finalNodeIris = new Set<string>([center]);
    const propertyIris = new Set<string>();
    
    for (const edge of limitedEdges) {
      finalNodeIris.add(edge.source);
      finalNodeIris.add(edge.targetIri);
      propertyIris.add(edge.property);
    }

    const labels = await this.fetchLabels([...Array.from(finalNodeIris), ...Array.from(propertyIris)], workspace);

    const nodes: DiagramNode[] = Array.from(finalNodeIris).map((iri) => ({
      id: this.stableId(['node', iri]),
      iri,
      label: labels.get(iri) ?? this.iriFragment(iri),
      isCenter: iri === center
    }));

    const nodeIdByIri = new Map(nodes.map((node) => [node.iri, node.id] as const));

    const responseEdges: DiagramEdge[] = limitedEdges.map((edge) => ({
      id: this.stableId(['edge', edge.source, edge.property, edge.targetIri, edge.kind, edge.cardinality ?? '']),
      source: nodeIdByIri.get(edge.source) ?? this.stableId(['node', edge.source]),
      target: nodeIdByIri.get(edge.targetIri) ?? this.stableId(['node', edge.targetIri]),
      property: edge.property,
      label: labels.get(edge.property) ?? this.iriFragment(edge.property),
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
        cardinality
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
        cardinality: rawCardinality !== undefined && !Number.isNaN(rawCardinality) ? rawCardinality : undefined
      });
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

  private async fetchLabels(iris: string[], workspace?: string): Promise<Map<string, string>> {
    if (iris.length === 0) {
      return new Map();
    }
    const labels = new Map<string, string>();
    for (const iri of iris) {
      for (const predicate of LABEL_PREDICATES) {
        const rows = await this.graphStore.select(
          this.prepareQuery(LABEL_QUERY, workspace),
          { entity: { type: 'iri', value: iri }, predicate: { type: 'iri', value: predicate } },
          workspace
        );
        for (const row of rows) {
          const labelBinding = row.label;
          if (!labelBinding || labelBinding.type !== 'literal') {
            continue;
          }
          const current = labels.get(iri);
          if (!current) {
            labels.set(iri, labelBinding.value);
            continue;
          }
          if (labelBinding.language === 'en' && current !== labelBinding.value) {
            labels.set(iri, labelBinding.value);
          }
        }
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
  kind: Restriction['kind'];
  cardinality?: number;
};
