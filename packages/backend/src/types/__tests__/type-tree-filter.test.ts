import { describe, expect, it } from 'vitest';
import type { TypeTreeNode } from '@acme/shared';

import { filterMaterializedTree, type MaterializedTree, type RawClassNode } from '../types.service.js';

const NS = 'http://acme.example/onto#';

// child -> parents. Roots have no entry with parents.
function makeTree(edges: Record<string, string[]>, counts: Record<string, number> = {}): MaterializedTree {
  const nodes = new Map<string, RawClassNode>();
  const ensure = (name: string) => {
    const iri = NS + name;
    if (!nodes.has(iri)) nodes.set(iri, { iri, parents: new Set(), labels: [], label: name });
    return nodes.get(iri)!;
  };
  for (const [child, parents] of Object.entries(edges)) {
    const node = ensure(child);
    for (const parent of parents) {
      ensure(parent);
      node.parents.add(NS + parent);
    }
  }
  const childrenByParent = new Map<string, Set<string>>();
  for (const node of nodes.values()) {
    const keys = node.parents.size === 0 ? ['__ROOT__'] : [...node.parents];
    for (const key of keys) {
      const set = childrenByParent.get(key) ?? new Set<string>();
      set.add(node.iri);
      childrenByParent.set(key, set);
    }
  }
  const individualCounts = new Map(Object.entries(counts).map(([k, v]) => [NS + k, v] as const));
  return { nodes, childrenByParent, individualCounts };
}

// Compact "Label*" (matched) / "Label" outline for assertions.
function outline(nodes: TypeTreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.label}${n.matched ? '*' : ''}`,
    ...outline(n.children, depth + 1)
  ]);
}

const TREE = makeTree({
  Thing: [],
  Equipment: ['Thing'],
  RotatingEquipment: ['Equipment'],
  Pump: ['RotatingEquipment'],
  CentrifugalPump: ['Pump'],
  Valve: ['Equipment'],
  Place: ['Thing'],
  PumpStation: ['Place']
}, { Pump: 3 });

describe('filterMaterializedTree', () => {
  it('finds matches deep in the hierarchy and keeps their ancestors', () => {
    expect(outline(filterMaterializedTree(TREE, 'pump'))).toEqual([
      'Thing',
      '  Equipment',
      '    RotatingEquipment',
      '      Pump*',
      '        CentrifugalPump*',
      '  Place',
      '    PumpStation*'
    ]);
  });

  it('keeps the real child and individual counts of each class', () => {
    const [thing] = filterMaterializedTree(TREE, 'centrifugal');
    const pump = thing.children[0].children[0].children[0];
    expect(pump).toMatchObject({ label: 'Pump', matched: false, childCount: 1, hasChildren: true, individualCount: 3 });
    expect(thing.childCount).toBe(2);
  });

  it('returns nothing for a blank or unmatched query', () => {
    expect(filterMaterializedTree(TREE, '   ')).toEqual([]);
    expect(filterMaterializedTree(TREE, 'zzz')).toEqual([]);
  });

  it('shows a match under each of its parents', () => {
    const tree = makeTree({ A: [], B: [], Shared: ['A', 'B'] });
    expect(outline(filterMaterializedTree(tree, 'shared'))).toEqual(['A', '  Shared*', 'B', '  Shared*']);
  });

  it('terminates on subclass cycles', () => {
    const tree = makeTree({ Root: [], X: ['Root', 'Y'], Y: ['X'] });
    expect(outline(filterMaterializedTree(tree, 'y'))).toEqual(['Root', '  X', '    Y*']);
  });
});
