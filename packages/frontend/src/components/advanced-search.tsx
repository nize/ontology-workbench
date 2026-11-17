"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { Box, ChevronLeft, ChevronRight, FileText, Layers, Loader2, Search, X } from "lucide-react"
import type {
  EntityType,
  SearchFacetName,
  SearchFacetValue,
  SearchFilters,
  SearchHighlightField,
  SearchHit,
  SearchResponse,
} from "@acme/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDebounce } from "@/hooks/use-debounce"
import { diagramQueryKey, fetchDiagram } from "@/hooks/use-diagram"
import { entityQueryKey, fetchEntity } from "@/hooks/use-entity"
import { apiGetJson } from "@/lib/api"
import {
  SEARCH_FIELDS,
  countActiveFilters,
  isFacetValueSelected,
  readAdvancedSearch,
  toSearchApiParams,
  toggleFacetValue,
  toggleField,
  writeAdvancedSearch,
  type AdvancedSearchState,
} from "@/lib/search-filters"
import { readRadius, updateUrlParams } from "@/lib/url-state"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 25
const COLLAPSED_FACET_VALUES = 6

const FACET_TITLES: Record<SearchFacetName, string> = {
  type: "Entity type",
  propertyKind: "Property kind",
  instanceOf: "Instance of class",
  definedBy: "Defined by",
  namespace: "Namespace",
  deprecated: "Status",
}

// Order the facet groups appear in the sidebar.
const FACET_ORDER: SearchFacetName[] = ["type", "propertyKind", "instanceOf", "definedBy", "namespace", "deprecated"]

const FIELD_LABELS: Record<SearchHighlightField, string> = {
  label: "Labels",
  alias: "Synonyms",
  comment: "Descriptions",
}

async function fetchAdvancedSearch(state: AdvancedSearchState, workspace?: string): Promise<SearchResponse> {
  const params = toSearchApiParams(state, { pageSize: PAGE_SIZE, workspace, facets: true })
  return apiGetJson<SearchResponse>(`/search?${params.toString()}`, { telemetryKey: "search.advanced" })
}

const TypeIcon = ({ type }: { type: EntityType }) => {
  switch (type) {
    case "class":
      return <Layers className="h-4 w-4 text-blue-500" />
    case "property":
      return <Box className="h-4 w-4 text-green-500" />
    default:
      return <FileText className="h-4 w-4 text-orange-500" />
  }
}

export function AdvancedSearch({ workspace }: { workspace?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const radius = readRadius(searchParams)

  const state = React.useMemo(() => readAdvancedSearch(searchParams), [searchParams])
  const [queryInput, setQueryInput] = React.useState(state.query)
  const debouncedQuery = useDebounce(queryInput, 300)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Filter changes only touch this client component, so update the URL without a
  // server round trip; Next keeps useSearchParams in sync with history.replaceState.
  const navigate = React.useCallback(
    (next: AdvancedSearchState) => {
      const params = writeAdvancedSearch(new URLSearchParams(searchParams.toString()), next)
      params.set("pane", "search")
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`)
    },
    [pathname, searchParams]
  )

  // Typing updates the URL once it settles; a new query starts at the first page.
  React.useEffect(() => {
    if (debouncedQuery.trim() !== state.query) {
      navigate({ ...state, query: debouncedQuery, page: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  // Follow the URL when it changes from elsewhere (back/forward, the header search).
  React.useEffect(() => {
    setQueryInput((current) => (current.trim() === state.query ? current : state.query))
  }, [state.query])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["search", "advanced", state, workspace],
    queryFn: () => fetchAdvancedSearch(state, workspace),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  const setFilters = (filters: SearchFilters) => navigate({ ...state, filters, page: 0 })
  const activeCount = countActiveFilters(state.filters)
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const facets = data?.facets

  const facetLabel = (facet: SearchFacetName, value: string) =>
    facets?.[facet]?.find((item) => item.value === value)?.label ?? value

  const openHit = (hit: SearchHit) => {
    const params = updateUrlParams(searchParams, {
      center: hit.iri,
      entity: hit.iri,
      pane: "diagram",
      details: "on",
    })
    router.push(`${pathname}?${params.toString()}`)
  }

  const prefetchHit = (hit: SearchHit) => {
    queryClient.prefetchQuery({
      queryKey: entityQueryKey(hit.iri, workspace),
      queryFn: () => fetchEntity(hit.iri, workspace),
    })
    queryClient.prefetchQuery({
      queryKey: diagramQueryKey(hit.iri, radius, workspace),
      queryFn: () => fetchDiagram(hit.iri, radius, workspace),
    })
  }

  const chips: { key: string; label: string; onRemove: () => void }[] = []
  for (const facet of FACET_ORDER) {
    const values =
      facet === "deprecated"
        ? state.filters.deprecated
          ? [state.filters.deprecated]
          : []
        : (selectedValues(state.filters, facet) ?? [])
    for (const value of values) {
      chips.push({
        key: `${facet}:${value}`,
        label: `${FACET_TITLES[facet]}: ${facetLabel(facet, value)}`,
        onRemove: () => setFilters(toggleFacetValue(state.filters, facet, value)),
      })
    }
  }
  if (state.filters.fields?.length) {
    chips.push({
      key: "fields",
      label: `Match in: ${state.filters.fields.map((field) => FIELD_LABELS[field]).join(", ")}`,
      onRemove: () => setFilters({ ...state.filters, fields: undefined }),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search the ontology"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate({ ...state, query: queryInput, page: 0 })
            }}
            placeholder="Search labels, synonyms and descriptions — or leave empty to browse by filters"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {data ? `${total.toLocaleString()} result${total === 1 ? "" : "s"}` : "Searching…"}
          </span>
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-xs items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs"
            >
              <span className="truncate" title={chip.label}>
                {chip.label}
              </span>
              <button
                type="button"
                onClick={chip.onRemove}
                className="rounded-full p-0.5 hover:bg-muted"
                aria-label={`Remove filter ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters({})}>
              Clear all filters
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          aria-label="Search filters"
          className="max-h-[40vh] shrink-0 space-y-5 overflow-y-auto overflow-x-hidden border-b p-4 md:max-h-none md:w-72 md:border-b-0 md:border-r"
        >
          <fieldset className="min-w-0 space-y-1.5">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Match query in
            </legend>
            {SEARCH_FIELDS.map((field) => {
              const checked = !state.filters.fields || state.filters.fields.includes(field)
              const isLastChecked = checked && (state.filters.fields?.length ?? SEARCH_FIELDS.length) === 1
              return (
                <label key={field} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    aria-label={`Match in ${FIELD_LABELS[field]}`}
                    checked={checked}
                    disabled={isLastChecked}
                    onChange={() => setFilters(toggleField(state.filters, field))}
                  />
                  {FIELD_LABELS[field]}
                </label>
              )
            })}
          </fieldset>

          {FACET_ORDER.map((facet) => (
            <FacetGroup
              key={facet}
              facet={facet}
              title={FACET_TITLES[facet]}
              values={facets?.[facet] ?? []}
              filters={state.filters}
              onToggle={(value) => setFilters(toggleFacetValue(state.filters, facet, value))}
            />
          ))}
        </aside>

        <section aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto">
          {isError && !data ? (
            <div className="space-y-2 p-8 text-center text-sm text-destructive">
              <div>Search request failed.</div>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : !data ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : data.hits.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No results match this search.
              {activeCount > 0 && " Try removing a filter."}
            </div>
          ) : (
            <>
              <ul className={cn("divide-y", isFetching && "opacity-70")}>
                {data.hits.map((hit) => (
                  <li key={hit.iri}>
                    <button
                      type="button"
                      aria-label={`Open ${hit.label} (${hit.type})`}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
                      onClick={() => openHit(hit)}
                      onMouseEnter={() => prefetchHit(hit)}
                      onFocus={() => prefetchHit(hit)}
                    >
                      <div className="mt-0.5 shrink-0">
                        <TypeIcon type={hit.type} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("text-sm font-medium", hit.deprecated && "line-through decoration-1")}>
                            {hit.label}
                          </span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">
                            {hit.propertyKind ? `${hit.propertyKind} property` : hit.type}
                          </Badge>
                          {hit.deprecated && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[10px] uppercase">
                              Deprecated
                            </Badge>
                          )}
                        </div>
                        {hit.highlights.length > 0 && hit.highlights[0].field !== "label" ? (
                          <div
                            className="line-clamp-2 text-xs text-muted-foreground [&>mark]:rounded-sm [&>mark]:bg-yellow-200 [&>mark]:px-0.5 [&>mark]:text-black"
                            dangerouslySetInnerHTML={{ __html: hit.highlights[0].snippet }}
                          />
                        ) : hit.comment ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">{hit.comment}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="truncate font-mono" title={hit.iri}>
                            {hit.iri}
                          </span>
                          {hit.instanceOf && hit.instanceOf.length > 0 && (
                            <span>
                              Instance of {hit.instanceOf.map((iri) => facetLabel("instanceOf", iri)).join(", ")}
                            </span>
                          )}
                          {hit.definedBy && hit.definedBy.length > 0 && (
                            <span>
                              Defined by {hit.definedBy.map((iri) => facetLabel("definedBy", iri)).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {pageCount > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={state.page === 0}
                    onClick={() => navigate({ ...state, page: state.page - 1 })}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                  </Button>
                  <span className="text-muted-foreground">
                    Page {state.page + 1} of {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={state.page + 1 >= pageCount}
                    onClick={() => navigate({ ...state, page: state.page + 1 })}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function selectedValues(filters: SearchFilters, facet: Exclude<SearchFacetName, "deprecated">): string[] | undefined {
  switch (facet) {
    case "type":
      return filters.types
    case "definedBy":
      return filters.definedBy
    case "namespace":
      return filters.namespaces
    case "propertyKind":
      return filters.propertyKinds
    case "instanceOf":
      return filters.instanceOf
  }
}

function FacetGroup({
  facet,
  title,
  values,
  filters,
  onToggle,
}: {
  facet: SearchFacetName
  title: string
  values: SearchFacetValue[]
  filters: SearchFilters
  onToggle: (value: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  if (values.length === 0) return null

  // Selected values stay visible even when the list is collapsed.
  const visible = expanded
    ? values
    : values.filter((value, index) => index < COLLAPSED_FACET_VALUES || isFacetValueSelected(filters, facet, value.value))
  const hidden = values.length - visible.length

  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      {visible.map((value) => {
        const checked = isFacetValueSelected(filters, facet, value.value)
        return (
          <label
            key={value.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 text-sm",
              value.count === 0 && !checked && "opacity-50"
            )}
            title={value.value}
          >
            <input
              type={facet === "deprecated" ? "radio" : "checkbox"}
              name={facet === "deprecated" ? "facet-deprecated" : undefined}
              className="h-3.5 w-3.5 shrink-0 accent-primary"
              aria-label={`${title}: ${value.label} (${value.count})`}
              checked={checked}
              onChange={() => onToggle(value.value)}
              onClick={() => {
                // A radio can't be unchecked by clicking it; let the toggle clear it instead.
                if (facet === "deprecated" && checked) onToggle(value.value)
              }}
            />
            <span className="min-w-0 flex-1 truncate">{value.label}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{value.count.toLocaleString()}</span>
          </label>
        )
      })}
      {(hidden > 0 || expanded) && values.length > COLLAPSED_FACET_VALUES && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </fieldset>
  )
}
