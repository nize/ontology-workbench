import { useQuery } from "@tanstack/react-query";
import { EntityDetails } from "@/types/entity";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

async function fetchEntity(iri: string): Promise<EntityDetails> {
  const encodedIri = encodeURIComponent(iri);
  const res = await fetch(`${API_BASE}/entities/${encodedIri}`);
  
  if (!res.ok) {
    throw new Error("Failed to fetch entity details");
  }
  
  return res.json();
}

export function useEntity(iri: string | null) {
  return useQuery({
    queryKey: ["entity", iri],
    queryFn: () => fetchEntity(iri!),
    enabled: !!iri,
  });
}
