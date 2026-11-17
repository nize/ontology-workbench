import { describe, it, expect } from "vitest"
import type { DiagramEdge, DiagramNode, DiagramResponse } from "@acme/shared"

import { applyHiddenNodes } from "../lib/diagram-hide"

const node = (id: string, isCenter = false): DiagramNode => ({
  id,
  iri: `http://ex/${id}`,
  label: id.toUpperCase(),
  isCenter,
  kind: "class",
})

const edge = (source: string, target: string, property: string): DiagramEdge => ({
  id: `${source}-${property}-${target}`,
  source,
  target,
  property,
  kind: "some",
})

const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramResponse => ({
  center: nodes.find((n) => n.isCenter)?.id ?? nodes[0].id,
  radius: 2,
  nodes,
  edges,
  truncated: false,
})

describe("applyHiddenNodes", () => {
  it("returns the diagram unchanged when nothing is hidden", () => {
    const data = diagram([node("a", true), node("b")], [edge("a", "b", "p")])
    const result = applyHiddenNodes(data, new Set())
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    expect(result.derivedEdges).toEqual([])
  })

  it("drops a leaf node and its edges without deriving anything", () => {
    const data = diagram([node("a", true), node("b")], [edge("a", "b", "p")])
    const result = applyHiddenNodes(data, new Set(["b"]))
    expect(result.nodes.map((n) => n.id)).toEqual(["a"])
    expect(result.edges).toEqual([])
    expect(result.derivedEdges).toEqual([])
  })

  it("turns a path through a hidden intermediate node into a derived edge", () => {
    const data = diagram(
      [node("a", true), node("h"), node("b")],
      [edge("a", "h", "p"), edge("h", "b", "q")]
    )
    const result = applyHiddenNodes(data, new Set(["h"]))
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(result.edges).toEqual([])
    expect(result.derivedEdges).toHaveLength(1)
    expect(result.derivedEdges[0]).toMatchObject({
      source: "a",
      target: "b",
      properties: ["p", "q"],
      via: ["H"],
    })
  })

  it("derives one edge per in/out pair of a hidden hub", () => {
    const data = diagram(
      [node("a", true), node("b"), node("h"), node("c"), node("d")],
      [edge("a", "h", "p"), edge("b", "h", "p"), edge("h", "c", "q"), edge("h", "d", "r")]
    )
    const result = applyHiddenNodes(data, new Set(["h"]))
    const pairs = result.derivedEdges.map((e) => `${e.source}->${e.target}`).sort()
    expect(pairs).toEqual(["a->c", "a->d", "b->c", "b->d"])
  })

  it("follows chains of several hidden nodes", () => {
    const data = diagram(
      [node("a", true), node("h1"), node("h2"), node("b")],
      [edge("a", "h1", "p"), edge("h1", "h2", "q"), edge("h2", "b", "r")]
    )
    const result = applyHiddenNodes(data, new Set(["h1", "h2"]))
    expect(result.derivedEdges).toHaveLength(1)
    expect(result.derivedEdges[0]).toMatchObject({
      source: "a",
      target: "b",
      properties: ["p", "q", "r"],
      via: ["H1", "H2"],
    })
  })

  it("does not derive self loops or loop forever on hidden cycles", () => {
    const data = diagram(
      [node("a", true), node("h1"), node("h2")],
      [edge("a", "h1", "p"), edge("h1", "h2", "q"), edge("h2", "h1", "r"), edge("h2", "a", "s")]
    )
    const result = applyHiddenNodes(data, new Set(["h1", "h2"]))
    expect(result.derivedEdges).toEqual([])
  })

  it("does not connect nodes that only point at the hidden node", () => {
    const data = diagram(
      [node("a", true), node("b"), node("h")],
      [edge("a", "h", "p"), edge("b", "h", "p")]
    )
    const result = applyHiddenNodes(data, new Set(["h"]))
    expect(result.derivedEdges).toEqual([])
  })

  it("never hides the center node", () => {
    const data = diagram([node("a", true), node("b")], [edge("a", "b", "p")])
    const result = applyHiddenNodes(data, new Set(["a"]))
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(result.edges).toHaveLength(1)
  })
})
