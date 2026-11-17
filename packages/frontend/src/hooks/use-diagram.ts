import { useQuery } from "@tanstack/react-query"
import { DiagramResponse } from "@acme/shared"

import { apiGetJson } from "@/lib/api"
import { usePreferredLanguage } from "@/hooks/use-preferred-language"

export function diagramQueryKey(center: string, radius: number, workspace?: string, lang?: string) {
  return ["diagram", center, radius, workspace, lang] as const
}

export async function fetchDiagram(
  center: string,
  radius: number,
  workspace?: string,
  lang?: string
): Promise<DiagramResponse> {
  const params = new URLSearchParams()
  params.set("center", center)
  params.set("radius", String(radius))
  if (workspace) params.set("workspace", workspace)
  if (lang) params.set("lang", lang)
  return apiGetJson<DiagramResponse>(`/diagram?${params.toString()}`, {
    telemetryKey: "diagram.view"
  })
}

export function useDiagram(center: string, radius: number, workspace?: string) {
  const lang = usePreferredLanguage()
  return useQuery({
    queryKey: diagramQueryKey(center, radius, workspace, lang),
    queryFn: () => fetchDiagram(center, radius, workspace, lang),
    enabled: !!center
  })
}
