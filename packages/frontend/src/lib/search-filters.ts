import type {
  DeprecatedFilter,
  EntityType,
  PropertyKind,
  SearchFacetName,
  SearchFilters,
  SearchHighlightField,
} from "@acme/shared"

/**
 * Advanced search state lives in the page URL (so a filtered search is a shareable
 * link) under the same parameter names the backend's `GET /search` uses.
 */
export interface AdvancedSearchState {
  query: string
  filters: SearchFilters
  /** Zero-based results page. */
  page: number
}

type ParamsReader = Pick<URLSearchParams, "get" | "getAll">

const ENTITY_TYPES: readonly EntityType[] = ["class", "property", "individual"]
const PROPERTY_KINDS: readonly PropertyKind[] = ["object", "datatype", "annotation"]
const FIELDS: readonly SearchHighlightField[] = ["label", "alias", "comment"]
const DEPRECATED: readonly DeprecatedFilter[] = ["include", "exclude", "only"]

/** Every URL key the advanced search owns; cleared before writing new state. */
export const ADVANCED_SEARCH_KEYS = [
  "q",
  "type",
  "definedBy",
  "namespace",
  "propertyKind",
  "instanceOf",
  "deprecated",
  "fields",
  "page",
] as const

type ListFilterKey = "types" | "definedBy" | "namespaces" | "propertyKinds" | "instanceOf"

/** Facet name → the filter it drives (deprecated is a single choice, not a list). */
const FACET_FILTER_KEY: Record<Exclude<SearchFacetName, "deprecated">, ListFilterKey> = {
  type: "types",
  definedBy: "definedBy",
  namespace: "namespaces",
  propertyKind: "propertyKinds",
  instanceOf: "instanceOf",
}

function enumList<T extends string>(values: string[], allowed: readonly T[]): T[] | undefined {
  const result = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is T => (allowed as readonly string[]).includes(value))
  return result.length > 0 ? Array.from(new Set(result)) : undefined
}

function iriList(values: string[]): string[] | undefined {
  const result = values.map((value) => value.trim()).filter(Boolean)
  return result.length > 0 ? Array.from(new Set(result)) : undefined
}

export function readAdvancedSearch(params: ParamsReader): AdvancedSearchState {
  const deprecated = DEPRECATED.find((value) => value === params.get("deprecated"))
  const page = Number.parseInt(params.get("page") ?? "", 10)
  return {
    query: params.get("q") ?? "",
    filters: {
      types: enumList(params.getAll("type"), ENTITY_TYPES),
      definedBy: iriList(params.getAll("definedBy")),
      namespaces: iriList(params.getAll("namespace")),
      propertyKinds: enumList(params.getAll("propertyKind"), PROPERTY_KINDS),
      instanceOf: iriList(params.getAll("instanceOf")),
      deprecated: deprecated && deprecated !== "include" ? deprecated : undefined,
      fields: enumList(params.getAll("fields"), FIELDS),
    },
    page: Number.isFinite(page) && page > 0 ? page : 0,
  }
}

function appendFilters(target: URLSearchParams, filters: SearchFilters) {
  if (filters.types?.length) target.set("type", filters.types.join(","))
  filters.definedBy?.forEach((iri) => target.append("definedBy", iri))
  filters.namespaces?.forEach((iri) => target.append("namespace", iri))
  if (filters.propertyKinds?.length) target.set("propertyKind", filters.propertyKinds.join(","))
  filters.instanceOf?.forEach((iri) => target.append("instanceOf", iri))
  if (filters.deprecated && filters.deprecated !== "include") target.set("deprecated", filters.deprecated)
  if (filters.fields?.length) target.set("fields", filters.fields.join(","))
}

/** Writes the state over `base`, keeping unrelated params (workspace, details, …). */
export function writeAdvancedSearch(base: URLSearchParams, state: AdvancedSearchState): URLSearchParams {
  const next = new URLSearchParams(base.toString())
  ADVANCED_SEARCH_KEYS.forEach((key) => next.delete(key))
  if (state.query.trim()) next.set("q", state.query.trim())
  appendFilters(next, state.filters)
  if (state.page > 0) next.set("page", String(state.page))
  return next
}

export function toSearchApiParams(
  state: AdvancedSearchState,
  options: { pageSize: number; workspace?: string; facets?: boolean }
): URLSearchParams {
  const params = new URLSearchParams()
  params.set("q", state.query.trim())
  appendFilters(params, state.filters)
  params.set("limit", String(options.pageSize))
  params.set("offset", String(state.page * options.pageSize))
  if (options.facets) params.set("facets", "true")
  if (options.workspace) params.set("workspace", options.workspace)
  return params
}

export function isFacetValueSelected(filters: SearchFilters, facet: SearchFacetName, value: string): boolean {
  if (facet === "deprecated") return filters.deprecated === value
  const list = filters[FACET_FILTER_KEY[facet]] as string[] | undefined
  return list?.includes(value) ?? false
}

/** Adds or removes one facet value; deprecated toggles between that choice and "include". */
export function toggleFacetValue(filters: SearchFilters, facet: SearchFacetName, value: string): SearchFilters {
  if (facet === "deprecated") {
    const choice = DEPRECATED.find((candidate) => candidate === value)
    return { ...filters, deprecated: filters.deprecated === choice || choice === "include" ? undefined : choice }
  }
  const key = FACET_FILTER_KEY[facet]
  const current = (filters[key] as string[] | undefined) ?? []
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  return { ...filters, [key]: next.length > 0 ? next : undefined }
}

export function toggleField(filters: SearchFilters, field: SearchHighlightField): SearchFilters {
  // No restriction means every field is searched, so start from all of them.
  const current = filters.fields ?? [...FIELDS]
  const next = current.includes(field) ? current.filter((item) => item !== field) : [...current, field]
  // All fields (or none, which the UI prevents) is the same as no restriction.
  return { ...filters, fields: next.length > 0 && next.length < FIELDS.length ? next : undefined }
}

/** Number of individual filter selections, for the "Filters (n)" badge. */
export function countActiveFilters(filters: SearchFilters): number {
  return (
    (filters.types?.length ?? 0) +
    (filters.definedBy?.length ?? 0) +
    (filters.namespaces?.length ?? 0) +
    (filters.propertyKinds?.length ?? 0) +
    (filters.instanceOf?.length ?? 0) +
    (filters.deprecated ? 1 : 0) +
    (filters.fields?.length ? 1 : 0)
  )
}

export const SEARCH_FIELDS = FIELDS
