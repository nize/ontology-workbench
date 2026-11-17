import type { DiagramEdge, DiagramNode, DiagramResponse } from "@acme/shared"

/** A node the user has put on the hidden stack. */
export interface HiddenNode {
  id: string
  label: string
  kind: DiagramNode["kind"]
}

/**
 * An edge that replaces a path running through one or more hidden nodes.
 * For A -p-> H -q-> B with H hidden, the derived edge is A -> B with
 * properties [p, q] and via [H].
 */
export interface DerivedEdge {
  id: string
  source: string
  target: string
  properties: string[]
  via: string[]
}

export interface VisibleDiagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  derivedEdges: DerivedEdge[]
}

/** Longest chain of hidden nodes a derived edge may pass through. */
const MAX_HIDDEN_CHAIN = 8

export function edgeLabel(edge: DiagramEdge): string {
  return edge.label || edge.property
}

/**
 * Removes hidden nodes from a diagram. Edges whose endpoints are both visible
 * are kept; every directed path that leaves a visible node, runs through
 * hidden nodes only and arrives at another visible node becomes a derived edge.
 * The center node is never hidden.
 */
export function applyHiddenNodes(data: DiagramResponse, hiddenIds: ReadonlySet<string>): VisibleDiagram {
  const isHidden = (node: DiagramNode) => hiddenIds.has(node.id) && !node.isCenter
  const hidden = new Set(data.nodes.filter(isHidden).map((n) => n.id))
  if (hidden.size === 0) {
    return { nodes: data.nodes, edges: data.edges, derivedEdges: [] }
  }

  const labelOf = new Map(data.nodes.map((n) => [n.id, n.label]))
  const outgoing = new Map<string, DiagramEdge[]>()
  for (const edge of data.edges) {
    const list = outgoing.get(edge.source)
    if (list) list.push(edge)
    else outgoing.set(edge.source, [edge])
  }

  const nodes = data.nodes.filter((n) => !hidden.has(n.id))
  const edges = data.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target))

  const derived = new Map<string, DerivedEdge>()
  const walk = (start: string, current: string, properties: string[], via: string[], seen: Set<string>) => {
    for (const edge of outgoing.get(current) ?? []) {
      const nextProps = [...properties, edgeLabel(edge)]
      if (!hidden.has(edge.target)) {
        if (edge.target === start) continue
        const key = `${start}\u0000${edge.target}\u0000${nextProps.join("\u0001")}\u0000${via.join("\u0001")}`
        if (!derived.has(key)) {
          derived.set(key, {
            // Stable across recomputes so the diagram can diff by id.
            id: `derived:${key}`,
            source: start,
            target: edge.target,
            properties: nextProps,
            via: via.map((id) => labelOf.get(id) ?? id),
          })
        }
        continue
      }
      if (seen.has(edge.target) || via.length >= MAX_HIDDEN_CHAIN) continue
      seen.add(edge.target)
      walk(start, edge.target, nextProps, [...via, edge.target], seen)
      seen.delete(edge.target)
    }
  }

  for (const node of nodes) {
    for (const edge of outgoing.get(node.id) ?? []) {
      if (!hidden.has(edge.target)) continue
      walk(node.id, edge.target, [edgeLabel(edge)], [edge.target], new Set([edge.target]))
    }
  }

  return { nodes, edges, derivedEdges: [...derived.values()] }
}
