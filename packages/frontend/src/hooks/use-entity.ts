import { useQuery } from "@tanstack/react-query";
import { EntityDetails } from "@/types/entity";
import { apiGetJson } from "@/lib/api";
import { usePreferredLanguage } from "@/hooks/use-preferred-language";

export function entityQueryKey(iri: string, workspace?: string, lang?: string) {
  return ["entity", iri, workspace, lang] as const
}

export async function fetchEntity(iri: string, workspace?: string, lang?: string): Promise<EntityDetails> {
  const encodedIri = encodeURIComponent(iri);
  const params = new URLSearchParams()
  if (workspace) params.set("workspace", workspace)
  if (lang) params.set("lang", lang)
  const query = params.toString()
  return apiGetJson<EntityDetails>(`/entities/${encodedIri}${query ? `?${query}` : ""}`, {
    telemetryKey: "entity.details"
  })
}

export function useEntity(iri: string | null, workspace?: string) {
  const lang = usePreferredLanguage();
  return useQuery({
    queryKey: iri ? entityQueryKey(iri, workspace, lang) : ["entity", "empty"],
    queryFn: () => fetchEntity(iri!, workspace, lang),
    enabled: !!iri,
  });
}
