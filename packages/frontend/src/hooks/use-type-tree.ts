import { useQuery } from "@tanstack/react-query";
import { TypeTreeNode } from "@acme/shared";
import { apiGetJson } from "@/lib/api";

export function typeTreeQueryKey(root: string | undefined, depth: number, workspace?: string) {
  return ["types", "tree", root, depth, workspace] as const
}

export async function fetchTypeTree(root?: string, depth: number = 1, workspace?: string): Promise<TypeTreeNode[]> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  params.set("depth", depth.toString());
  if (workspace) params.set("workspace", workspace)
  return apiGetJson<TypeTreeNode[]>(`/types/tree?${params.toString()}`, {
    telemetryKey: "types.tree"
  })
}

export function useTypeTree(root?: string, depth: number = 1, workspace?: string) {
  return useQuery({
    queryKey: typeTreeQueryKey(root, depth, workspace),
    queryFn: () => fetchTypeTree(root, depth, workspace),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
