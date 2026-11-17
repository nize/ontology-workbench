import { useInfiniteQuery } from "@tanstack/react-query"
import { IndividualsPage } from "@acme/shared"

import { apiGetJson } from "@/lib/api"
import { usePreferredLanguage } from "@/hooks/use-preferred-language"

export function individualsQueryKey(
  classIri: string,
  limit: number,
  offset: number,
  workspace?: string,
  lang?: string
) {
  return ["types", "individuals", classIri, limit, offset, workspace, lang] as const
}

export async function fetchIndividuals(
  classIri: string,
  limit: number,
  offset: number,
  workspace?: string,
  lang?: string
): Promise<IndividualsPage> {
  const params = new URLSearchParams()
  params.set("class", classIri)
  params.set("limit", String(limit))
  params.set("offset", String(offset))
  if (workspace) params.set("workspace", workspace)
  if (lang) params.set("lang", lang)
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
  const lang = usePreferredLanguage()
  return useInfiniteQuery({
    queryKey: ["types", "individuals", "infinite", classIri, pageSize, workspace, lang],
    queryFn: ({ pageParam }) => fetchIndividuals(classIri!, pageSize, pageParam, workspace, lang),
    initialPageParam: 0,
    getNextPageParam: nextIndividualsOffset,
    enabled: !!classIri && enabled,
    staleTime: 5 * 60 * 1000
  })
}
