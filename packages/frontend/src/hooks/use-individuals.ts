import { useInfiniteQuery } from "@tanstack/react-query"
import { IndividualsPage } from "@acme/shared"

import { apiGetJson } from "@/lib/api"

export function individualsQueryKey(classIri: string, limit: number, offset: number, workspace?: string) {
  return ["types", "individuals", classIri, limit, offset, workspace] as const
}

export async function fetchIndividuals(
  classIri: string,
  limit: number,
  offset: number,
  workspace?: string
): Promise<IndividualsPage> {
  const params = new URLSearchParams()
  params.set("class", classIri)
  params.set("limit", String(limit))
  params.set("offset", String(offset))
  if (workspace) params.set("workspace", workspace)
  return apiGetJson<IndividualsPage>(`/types/individuals?${params.toString()}`, {
    telemetryKey: "types.individuals"
  })
}

export function nextIndividualsOffset(page: IndividualsPage): number | undefined {
  const next = page.offset + page.items.length
  return page.items.length > 0 && next < page.total ? next : undefined
}

/** Individuals of a class, loaded a page at a time. */
export function useIndividuals(classIri: string | null, pageSize: number, workspace?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["types", "individuals", "infinite", classIri, pageSize, workspace],
    queryFn: ({ pageParam }) => fetchIndividuals(classIri!, pageSize, pageParam, workspace),
    initialPageParam: 0,
    getNextPageParam: nextIndividualsOffset,
    enabled: !!classIri && enabled,
    staleTime: 5 * 60 * 1000
  })
}
