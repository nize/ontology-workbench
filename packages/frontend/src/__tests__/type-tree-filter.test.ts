import { describe, expect, it } from "vitest"
import type { TypeTreeNode } from "@acme/shared"

import { flattenFilteredTree } from "../lib/type-tree-filter"

const node = (label: string, children: TypeTreeNode[] = [], matched = false): TypeTreeNode => ({
  iri: `urn:x:${label}`,
  label,
  hasChildren: children.length > 0,
  childCount: children.length,
  matched,
  children,
})

describe("flattenFilteredTree", () => {
  it("lists every branch open, depth-first", () => {
    const tree = [
      node("Thing", [node("Equipment", [node("Pump", [], true)]), node("Place", [node("PumpStation", [], true)])]),
    ]
    expect(flattenFilteredTree(tree).map(({ node, depth }) => `${depth}:${node.label}`)).toEqual([
      "0:Thing",
      "1:Equipment",
      "2:Pump",
      "1:Place",
      "2:PumpStation",
    ])
  })

  it("is empty for an empty tree", () => {
    expect(flattenFilteredTree([])).toEqual([])
  })
})
