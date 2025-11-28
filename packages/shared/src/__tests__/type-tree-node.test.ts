import { describe, expect, it } from 'vitest';
import type { TypeTreeNode } from '../index.js';

describe('TypeTreeNode', () => {
  it('allows nested nodes with optional primaryParent', () => {
    const node: TypeTreeNode = {
      iri: 'iri:root',
      label: 'Root',
      hasChildren: true,
      childCount: 1,
      primaryParent: null,
      children: [
        {
          iri: 'iri:child',
          label: 'Child',
          hasChildren: false,
          childCount: 0,
          primaryParent: 'iri:root',
          children: [],
        },
      ],
    };

    expect(node.children[0].primaryParent).toBe('iri:root');
    expect(node.childCount).toBe(1);
    expect(node.hasChildren).toBe(true);
  });
});
