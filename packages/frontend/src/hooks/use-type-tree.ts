import { useQuery } from "@tanstack/react-query";
import { TypeTreeNode } from "@acme/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

async function fetchTypeTree(root?: string, depth: number = 1): Promise<TypeTreeNode[]> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  params.set("depth", depth.toString());

  const res = await fetch(`${API_BASE}/types/tree?${params.toString()}`);
  
  if (!res.ok) {
    throw new Error("Failed to fetch type tree");
  }
  
  return res.json();
}

export function useTypeTree(root?: string, depth: number = 1) {
  return useQuery({
    queryKey: ["types", "tree", root, depth],
    queryFn: () => fetchTypeTree(root, depth),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
