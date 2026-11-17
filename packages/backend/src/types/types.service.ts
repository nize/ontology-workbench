import { Inject, Injectable } from '@nestjs/common';
import { IndividualSummary, IndividualsPage, TypeTreeNode } from '@acme/shared';

import type { SparqlBinding } from '../sparql/graphStore.js';
import { GraphStoreService } from '../sparql/graphStore.service.js';
import { individualFilter } from '../sparql/individuals.js';

const CLASS_TYPES = [
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class'
];

const CLASS_IRIS_QUERY = `
  SELECT DISTINCT ?class
  WHERE {
    {{graphStart}}
      ?class a {{classType}} .
    {{graphEnd}}
  }
`;

const CLASS_LABELS_QUERY = `
  SELECT DISTINCT ?class ?label
  WHERE {
    {{graphStart}}
      ?class a {{classType}} .
      ?class <http://www.w3.org/2000/01/rdf-schema#label> ?label .
    {{graphEnd}}
  }
`;

const CLASS_PARENTS_QUERY = `
  SELECT DISTINCT ?class ?parent
  WHERE {
    {{graphStart}}
      ?class a {{classType}} .
      ?class <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?parent .
      FILTER(isIRI(?parent))
    {{graphEnd}}
  }
`;

const INDIVIDUAL_COUNTS_QUERY = `
  SELECT ?class (COUNT(DISTINCT ?ind) AS ?count)
  WHERE {
    {{graphStart}}
      ?ind a ?class .
      FILTER(isIRI(?class))
      ${individualFilter('ind')}
    {{graphEnd}}
  }
  GROUP BY ?class
`;

const CLASS_INDIVIDUALS_QUERY = `
  SELECT DISTINCT ?ind ?label
  WHERE {
    {{graphStart}}
      ?ind a {{class}} .
      ${individualFilter('ind')}
      OPTIONAL {
        ?ind <http://www.w3.org/2000/01/rdf-schema#label>|<http://www.w3.org/2004/02/skos/core#prefLabel> ?label .
      }
    {{graphEnd}}
  }
`;

export const DEFAULT_INDIVIDUALS_PAGE_SIZE = 50;
export const MAX_INDIVIDUALS_PAGE_SIZE = 500;

const ROOT_KEY = '__ROOT__';

interface RawClassNode {
  iri: string;
  parents: Set<string>;
  labels: SparqlBinding[];
  label?: string;
  primaryParent?: string | null;
}

interface MaterializedTree {
  nodes: Map<string, RawClassNode>;
  childrenByParent: Map<string, Set<string>>;
  individualCounts: Map<string, number>;
}

@Injectable()
export class TypesService {
  private cache = new Map<string, Promise<MaterializedTree>>();
  private individualsCache = new Map<string, Promise<IndividualSummary[]>>();

  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  invalidate(workspace?: string): void {
    if (workspace) {
      this.cache.delete(workspace);
      for (const key of this.individualsCache.keys()) {
        if (key.startsWith(`${workspace}|`)) {
          this.individualsCache.delete(key);
        }
      }
      return;
    }
    this.cache.clear();
    this.individualsCache.clear();
  }

  /**
   * Individuals whose direct rdf:type is `classIri`, sorted by label, one page at a time.
   */
  async getIndividuals(
    classIri: string,
    limit = DEFAULT_INDIVIDUALS_PAGE_SIZE,
    offset = 0,
    workspace?: string
  ): Promise<IndividualsPage> {
    const safeLimit = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), MAX_INDIVIDUALS_PAGE_SIZE)
      : DEFAULT_INDIVIDUALS_PAGE_SIZE;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    const all = await this.getSortedIndividuals(classIri, workspace);

    return {
      class: classIri,
      total: all.length,
      limit: safeLimit,
      offset: safeOffset,
      items: all.slice(safeOffset, safeOffset + safeLimit)
    };
  }

  private async getSortedIndividuals(classIri: string, workspace?: string): Promise<IndividualSummary[]> {
    const key = `${workspace ?? 'DEFAULT'}|${classIri}`;
    const cached = this.individualsCache.get(key);
    if (cached) {
      return cached;
    }

    const promise = this.loadSortedIndividuals(classIri, workspace);
    this.individualsCache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.individualsCache.delete(key);
      throw error;
    }
  }

  private async loadSortedIndividuals(classIri: string, workspace?: string): Promise<IndividualSummary[]> {
    const rows = await this.graphStore.select(
      this.prepareQuery(CLASS_INDIVIDUALS_QUERY, workspace),
      { class: { type: 'iri', value: classIri } },
      workspace
    );

    const labelsByIri = new Map<string, SparqlBinding[]>();
    for (const row of rows) {
      const iri = row.ind?.type === 'iri' ? row.ind.value : undefined;
      if (!iri || isBlankNodeIri(iri)) {
        continue;
      }
      const labels = labelsByIri.get(iri) ?? [];
      if (row.label) {
        labels.push(row.label);
      }
      labelsByIri.set(iri, labels);
    }

    const items = [...labelsByIri.entries()].map(([iri, labels]) => ({
      iri,
      label: this.resolveLabel(labels, iri)
    }));
    const labelOf = new Map(items.map((item) => [item.iri, item.label] as const));
    items.sort((a, b) => compareIris(a.iri, b.iri, (iri) => labelOf.get(iri) ?? fallbackLabel(iri)));
    return items;
  }

  async getTypeTree(root?: string, depth = 1, workspace?: string): Promise<TypeTreeNode[]> {
    const normalizedDepth = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 1;
    const tree = await this.getMaterializedTree(workspace);

    return this.buildSubtree(root ?? null, normalizedDepth, tree);
  }

  private async getMaterializedTree(workspace?: string): Promise<MaterializedTree> {
    const key = workspace ?? 'DEFAULT';
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const materializedPromise = this.loadMaterializedTree(workspace);
    this.cache.set(key, materializedPromise);

    try {
      return await materializedPromise;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  private async loadMaterializedTree(workspace?: string): Promise<MaterializedTree> {
    const nodes = new Map<string, RawClassNode>();
    for (const classType of CLASS_TYPES) {
      await this.mergeClassData(classType, workspace, nodes);
    }
    this.assignLabels(nodes);
    this.assignPrimaryParents(nodes);
    const childrenByParent = this.buildChildrenMap(nodes);
    const individualCounts = await this.loadIndividualCounts(nodes, workspace);

    return { nodes, childrenByParent, individualCounts };
  }

  private async loadIndividualCounts(
    nodes: Map<string, RawClassNode>,
    workspace?: string
  ): Promise<Map<string, number>> {
    const rows = await this.graphStore.select(
      this.prepareQuery(INDIVIDUAL_COUNTS_QUERY, workspace),
      {},
      workspace
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      const classIri = row.class?.type === 'iri' ? row.class.value : undefined;
      const count = row.count ? Number.parseInt(row.count.value, 10) : 0;
      if (classIri && nodes.has(classIri) && count > 0) {
        counts.set(classIri, count);
      }
    }
    return counts;
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

  private async mergeClassData(
    classType: string,
    workspace: string | undefined,
    nodes: Map<string, RawClassNode>
  ): Promise<void> {
    const classRows = await this.graphStore.select(
      this.prepareQuery(CLASS_IRIS_QUERY, workspace),
      { classType: { type: 'iri', value: classType } },
      workspace
    );

    for (const row of classRows) {
      const classIri = row.class?.type === 'iri' ? row.class.value : undefined;
      if (classIri) {
        this.ensureNode(nodes, classIri);
      }
    }

    const [labelRows, parentRows] = await Promise.all([
      this.graphStore.select(
        this.prepareQuery(CLASS_LABELS_QUERY, workspace),
        { classType: { type: 'iri', value: classType } },
        workspace
      ),
      this.graphStore.select(
        this.prepareQuery(CLASS_PARENTS_QUERY, workspace),
        { classType: { type: 'iri', value: classType } },
        workspace
      )
    ]);

    for (const row of labelRows) {
      const classIri = row.class?.type === 'iri' ? row.class.value : undefined;
      if (classIri && row.label) {
        const node = this.ensureNode(nodes, classIri);
        node.labels.push(row.label);
      }
    }

    for (const row of parentRows) {
      const classIri = row.class?.type === 'iri' ? row.class.value : undefined;
      const parentIri = row.parent?.type === 'iri' ? row.parent.value : undefined;
      if (classIri && parentIri && !isBlankNodeIri(parentIri)) {
        const node = this.ensureNode(nodes, classIri);
        node.parents.add(parentIri);
        this.ensureNode(nodes, parentIri);
      }
    }
  }

  private ensureNode(nodes: Map<string, RawClassNode>, iri: string): RawClassNode {
    let node = nodes.get(iri);
    if (!node) {
      node = { iri, parents: new Set(), labels: [] };
      nodes.set(iri, node);
    }
    return node;
  }

  private assignLabels(nodes: Map<string, RawClassNode>): void {
    for (const node of nodes.values()) {
      node.label = this.resolveLabel(node.labels, node.iri);
    }
  }

  private assignPrimaryParents(nodes: Map<string, RawClassNode>): void {
    const labelLookup = (iri: string) => nodes.get(iri)?.label ?? fallbackLabel(iri);

    for (const node of nodes.values()) {
      node.primaryParent = selectPrimaryParent(node.parents, labelLookup);
    }
  }

  private buildChildrenMap(nodes: Map<string, RawClassNode>): Map<string, Set<string>> {
    const childrenByParent = new Map<string, Set<string>>();

    for (const node of nodes.values()) {
      if (node.parents.size === 0) {
        const rootChildren = childrenByParent.get(ROOT_KEY) ?? new Set<string>();
        rootChildren.add(node.iri);
        childrenByParent.set(ROOT_KEY, rootChildren);
        continue;
      }

      for (const parent of node.parents) {
        const children = childrenByParent.get(parent) ?? new Set<string>();
        children.add(node.iri);
        childrenByParent.set(parent, children);
      }
    }

    return childrenByParent;
  }

  private buildSubtree(parent: string | null, depth: number, tree: MaterializedTree): TypeTreeNode[] {
    const parentKey = parent ?? ROOT_KEY;
    const children = tree.childrenByParent.get(parentKey);
    const sortedChildren = [...(children ?? [])].sort((a, b) =>
      compareIris(a, b, (iri) => tree.nodes.get(iri)?.label ?? fallbackLabel(iri))
    );

    return sortedChildren.map((iri) => {
      const node = tree.nodes.get(iri);
      const childSet = tree.childrenByParent.get(iri);
      const childCount = childSet?.size ?? 0;
      const hasChildren = childCount > 0;

      return {
        iri,
        label: node?.label ?? fallbackLabel(iri),
        primaryParent: node?.primaryParent ?? null,
        childCount,
        hasChildren,
        individualCount: tree.individualCounts.get(iri) ?? 0,
        children: depth > 1 ? this.buildSubtree(iri, depth - 1, tree) : []
      } satisfies TypeTreeNode;
    });
  }

  private resolveLabel(labels: SparqlBinding[], iri: string): string {
    const literalLabels = labels.filter((label) => label.type === 'literal');
    if (literalLabels.length === 0) {
      return fallbackLabel(iri);
    }

    const sorted = [...literalLabels].sort((a, b) => {
      if (a.language === 'en' && b.language !== 'en') {
        return -1;
      }
      if (a.language !== 'en' && b.language === 'en') {
        return 1;
      }
      if (!a.language && b.language) {
        return -1;
      }
      if (a.language && !b.language) {
        return 1;
      }

      const valueCompare = a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
      if (valueCompare !== 0) {
        return valueCompare;
      }

      const langA = a.language ?? '';
      const langB = b.language ?? '';
      return langA.localeCompare(langB);
    });

    return sorted[0].value;
  }
}

function selectPrimaryParent(parents: Set<string>, getLabel: (iri: string) => string): string | null {
  if (parents.size === 0) {
    return null;
  }
  const sortedParents = [...parents].sort((a, b) => compareIris(a, b, getLabel));
  return sortedParents[0];
}

function compareIris(a: string, b: string, getLabel: (iri: string) => string): number {
  const labelA = getLabel(a);
  const labelB = getLabel(b);
  const labelCompare = labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
  if (labelCompare !== 0) {
    return labelCompare;
  }
  return a.localeCompare(b);
}

function fallbackLabel(iri: string): string {
  const hashIndex = iri.lastIndexOf('#');
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return iri.slice(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < iri.length - 1) {
    return iri.slice(slashIndex + 1);
  }
  return iri;
}

function isBlankNodeIri(iri: string): boolean {
  return iri.startsWith('urn:blank:');
}
