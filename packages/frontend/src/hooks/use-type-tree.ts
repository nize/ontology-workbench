import { useQuery } from "@tanstack/react-query";
import { TypeTreeNode } from "@acme/shared";
import { apiGetJson } from "@/lib/api";
import { usePreferredLanguage } from "@/hooks/use-preferred-language";

export function typeTreeQueryKey(root: string | undefined, depth: number, workspace?: string, lang?: string) {
  return ["types", "tree", root, depth, workspace, lang] as const
}

export async function fetchTypeTree(
  root?: string,
  depth: number = 1,
  workspace?: string,
  lang?: string
): Promise<TypeTreeNode[]> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  params.set("depth", depth.toString());
  if (workspace) params.set("workspace", workspace)
  if (lang) params.set("lang", lang)
  return apiGetJson<TypeTreeNode[]>(`/types/tree?${params.toString()}`, {
    telemetryKey: "types.tree"
  })
}

export function useTypeTree(root?: string, depth: number = 1, workspace?: string) {
  const lang = usePreferredLanguage();
  return useQuery({
    queryKey: typeTreeQueryKey(root, depth, workspace, lang),
    queryFn: () => fetchTypeTree(root, depth, workspace, lang),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
