import type { TypeTreeNode } from "@acme/shared"

/**
 * Depth-first rows for a server-filtered type tree. The tree arrives already
 * pruned to matches and their ancestors, so every branch is shown open.
 */
export function flattenFilteredTree(
  nodes: TypeTreeNode[],
  depth = 0
): Array<{ node: TypeTreeNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenFilteredTree(node.children, depth + 1),
  ])
}
