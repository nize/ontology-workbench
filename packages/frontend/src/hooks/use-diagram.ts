import { useQuery } from "@tanstack/react-query"
import { DiagramResponse } from "@acme/shared"

import { apiGetJson } from "@/lib/api"

export function diagramQueryKey(center: string, radius: number, workspace?: string) {
  return ["diagram", center, radius, workspace] as const
}

export async function fetchDiagram(center: string, radius: number, workspace?: string): Promise<DiagramResponse> {
  const params = new URLSearchParams()
  params.set("center", center)
  params.set("radius", String(radius))
  if (workspace) params.set("workspace", workspace)
  return apiGetJson<DiagramResponse>(`/diagram?${params.toString()}`, {
    telemetryKey: "diagram.view"
  })
}

export function useDiagram(center: string, radius: number, workspace?: string) {
  return useQuery({
    queryKey: diagramQueryKey(center, radius, workspace),
    queryFn: () => fetchDiagram(center, radius, workspace),
    enabled: !!center
  })
}
