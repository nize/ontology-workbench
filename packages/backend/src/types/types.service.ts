import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { GraphStoreService } from '../sparql/graphStore.service.js';
import type { SparqlBinding } from '../sparql/graphStore.js';

export interface TypeTreeNode {
  iri: string;
  label: string;
  badges: {
    altParents: number;
  };
  hasChildren: boolean;
  children: TypeTreeNode[];
}

interface GetTreeOptions {
  root?: string;
  depth: number;
  workspace?: string;
}

interface TypesCache {
  nodes: Map<string, InternalTypeNode>;
  roots: string[];
}

interface InternalTypeNode {
  iri: string;
  label: string;
  primaryParent?: string;
  altParents: string[];
  children: string[];
}

interface MutableTypeNode {
  iri: string;
  labels: LabelCandidate[];
  parentSet: Set<string>;
  label?: string;
  primaryParent?: string;
  altParents: string[];
}

interface LabelCandidate {
  value: string;
  language?: string;
}

const CLASS_IRIS_QUERY = `
  SELECT DISTINCT ?class
  WHERE {
    GRAPH {{workspace}} {
      {
        ?class a <http://www.w3.org/2002/07/owl#Class>
      }
      UNION
      {
        ?class a <http://www.w3.org/2000/01/rdf-schema#Class>
      }
      UNION
      {
        ?child <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?class
      }
    }
  }
`;

const CLASS_LABELS_QUERY = `
  SELECT DISTINCT ?class ?label
  WHERE {
    GRAPH {{workspace}} {
      ?class <http://www.w3.org/2000/01/rdf-schema#label> ?label
    }
  }
`;

const CLASS_PARENTS_QUERY = `
  SELECT DISTINCT ?child ?parent
  WHERE {
    GRAPH {{workspace}} {
      {
        ?child a <http://www.w3.org/2002/07/owl#Class> .
        ?child <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?parent
      }
      UNION
      {
        ?child a <http://www.w3.org/2000/01/rdf-schema#Class> .
        ?child <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?parent
      }
    }
  }
`;

const DEFAULT_WORKSPACE_KEY = '__default__';

@Injectable()
export class TypesService {
  private readonly caches = new Map<string, Promise<TypesCache>>();

  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  async getTree(options: GetTreeOptions): Promise<TypeTreeNode[]> {
    const { root, depth, workspace } = options;
    const cache = await this.getWorkspaceCache(workspace);
    if (root) {
      const node = cache.nodes.get(root);
      if (!node) {
        throw new NotFoundException(`Type not found: ${root}`);
      }
      return [this.buildTreeNode(node.iri, depth, cache, new Set())];
    }
    return cache.roots.map((iri) => this.buildTreeNode(iri, depth, cache, new Set()));
  }

  invalidate(workspace?: string): void {
    if (workspace) {
      this.caches.delete(this.workspaceKey(workspace));
      return;
    }
    this.caches.clear();
  }

  private async getWorkspaceCache(workspace?: string): Promise<TypesCache> {
    const key = this.workspaceKey(workspace);
    const existing = this.caches.get(key);
    if (existing) {
      return existing;
    }
    const promise = this.buildCache(workspace);
    this.caches.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.caches.delete(key);
      throw error;
    }
  }

  private workspaceKey(workspace?: string): string {
    return workspace ?? DEFAULT_WORKSPACE_KEY;
  }

  private async buildCache(workspace?: string): Promise<TypesCache> {
    const [classRows, labelRows, parentRows] = await Promise.all([
      this.graphStore.select(CLASS_IRIS_QUERY, undefined, workspace),
      this.graphStore.select(CLASS_LABELS_QUERY, undefined, workspace),
      this.graphStore.select(CLASS_PARENTS_QUERY, undefined, workspace)
    ]);

    const nodes = new Map<string, MutableTypeNode>();

    for (const row of classRows) {
      const classBinding = row['class'];
      if (!isIriBinding(classBinding)) {
        continue;
      }
      ensureNode(nodes, classBinding.value);
    }

    for (const row of labelRows) {
      const classBinding = row['class'];
      if (!isIriBinding(classBinding)) {
        continue;
      }
      const node = ensureNode(nodes, classBinding.value);
      const labelBinding = row['label'];
      if (isLiteralBinding(labelBinding)) {
        node.labels.push({ value: labelBinding.value, language: labelBinding.language });
      }
    }

    for (const row of parentRows) {
      const childBinding = row['child'];
      const parentBinding = row['parent'];
      if (!isIriBinding(childBinding) || !isIriBinding(parentBinding)) {
        continue;
      }
      if (childBinding.value === parentBinding.value) {
        continue;
      }
      const childNode = ensureNode(nodes, childBinding.value);
      ensureNode(nodes, parentBinding.value);
      childNode.parentSet.add(parentBinding.value);
    }

    for (const node of nodes.values()) {
      node.label = chooseLabel(node.labels, node.iri);
    }

    const compareByLabel = (aIri: string, bIri: string): number => {
      const a = nodes.get(aIri);
      const b = nodes.get(bIri);
      if (!a || !b) {
        return 0;
      }
      const labelComparison = a.label!.localeCompare(b.label!);
      if (labelComparison !== 0) {
        return labelComparison;
      }
      return a.iri.localeCompare(b.iri);
    };

    const childrenByParent = new Map<string | null, string[]>();

    for (const node of nodes.values()) {
      const sortedParents = [...node.parentSet].sort(compareByLabel);
      const [primaryParent, ...rest] = sortedParents;
      node.primaryParent = primaryParent;
      node.altParents = rest;
      const parentKey = primaryParent ?? null;
      const children = ensureChildren(childrenByParent, parentKey);
      children.push(node.iri);
    }

    for (const childList of childrenByParent.values()) {
      childList.sort(compareByLabel);
    }

    const finalNodes = new Map<string, InternalTypeNode>();
    for (const node of nodes.values()) {
      finalNodes.set(node.iri, {
        iri: node.iri,
        label: node.label!,
        primaryParent: node.primaryParent,
        altParents: [...node.altParents],
        children: [...(childrenByParent.get(node.iri) ?? [])]
      });
    }

    const roots = [...(childrenByParent.get(null) ?? [])];

    return {
      nodes: finalNodes,
      roots
    };
  }

  private buildTreeNode(
    iri: string,
    depth: number,
    cache: TypesCache,
    visited: Set<string>
  ): TypeTreeNode {
    const node = cache.nodes.get(iri);
    if (!node) {
      throw new NotFoundException(`Type not found: ${iri}`);
    }
    const hasChildren = node.children.length > 0;
    if (depth <= 0) {
      return {
        iri: node.iri,
        label: node.label,
        badges: { altParents: node.altParents.length },
        hasChildren,
        children: []
      };
    }
    if (visited.has(iri)) {
      return {
        iri: node.iri,
        label: node.label,
        badges: { altParents: node.altParents.length },
        hasChildren,
        children: []
      };
    }
    visited.add(iri);
    try {
      const children: TypeTreeNode[] = [];
      for (const childIri of node.children) {
        if (visited.has(childIri)) {
          continue;
        }
        children.push(this.buildTreeNode(childIri, depth - 1, cache, visited));
      }
      return {
        iri: node.iri,
        label: node.label,
        badges: { altParents: node.altParents.length },
        hasChildren,
        children
      };
    } finally {
      visited.delete(iri);
    }
  }
}

function ensureNode(nodes: Map<string, MutableTypeNode>, iri: string): MutableTypeNode {
  let node = nodes.get(iri);
  if (!node) {
    node = {
      iri,
      labels: [],
      parentSet: new Set<string>(),
      altParents: []
    };
    nodes.set(iri, node);
  }
  return node;
}

function ensureChildren(map: Map<string | null, string[]>, parent: string | null): string[] {
  let children = map.get(parent);
  if (!children) {
    children = [];
    map.set(parent, children);
  }
  return children;
}

function chooseLabel(labels: LabelCandidate[], iri: string): string {
  if (labels.length === 0) {
    return fallbackLabel(iri);
  }
  const sorted = [...labels].sort((a, b) => {
    const priorityA = languagePriority(a.language);
    const priorityB = languagePriority(b.language);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    const langA = (a.language ?? '').localeCompare(b.language ?? '');
    if (langA !== 0) {
      return langA;
    }
    return a.value.localeCompare(b.value);
  });
  return sorted[0].value;
}

function languagePriority(language?: string): number {
  if (!language) {
    return 1;
  }
  const normalized = language.toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 0;
  }
  return 2;
}

function fallbackLabel(iri: string): string {
  const match = iri.match(/([^#\/]*)$/);
  const localName = match && match[1] ? match[1] : iri;
  return decodeURIComponentSafe(localName);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isIriBinding(binding: SparqlBinding | undefined): binding is SparqlBinding & { type: 'iri' } {
  return Boolean(binding && binding.type === 'iri');
}

function isLiteralBinding(binding: SparqlBinding | undefined): binding is SparqlBinding & { type: 'literal' } {
  return Boolean(binding && binding.type === 'literal');
}
