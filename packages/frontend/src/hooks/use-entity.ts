import { useQuery } from "@tanstack/react-query";
import { EntityDetails } from "@/types/entity";
import { apiGetJson } from "@/lib/api";

export function entityQueryKey(iri: string, workspace?: string) {
  return ["entity", iri, workspace] as const
}

export async function fetchEntity(iri: string, workspace?: string): Promise<EntityDetails> {
  const encodedIri = encodeURIComponent(iri);
  const params = new URLSearchParams()
  if (workspace) params.set("workspace", workspace)
  const query = params.toString()
  return apiGetJson<EntityDetails>(`/entities/${encodedIri}${query ? `?${query}` : ""}`, {
    telemetryKey: "entity.details"
  })
}

export function useEntity(iri: string | null, workspace?: string) {
  return useQuery({
    queryKey: iri ? entityQueryKey(iri, workspace) : ["entity", "empty"],
    queryFn: () => fetchEntity(iri!, workspace),
    enabled: !!iri,
  });
}
