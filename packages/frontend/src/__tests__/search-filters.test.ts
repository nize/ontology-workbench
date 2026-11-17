import { describe, expect, it } from "vitest"

import {
  countActiveFilters,
  isFacetValueSelected,
  readAdvancedSearch,
  toSearchApiParams,
  toggleFacetValue,
  toggleField,
  writeAdvancedSearch,
} from "../lib/search-filters"

const ACME = "http://acme.example/ontology#"

describe("advanced search URL state", () => {
  it("round-trips query, filters and page through the URL, keeping unrelated params", () => {
    const state = {
      query: "account",
      filters: {
        types: ["class" as const, "property" as const],
        definedBy: ["https://example.invalid/a,b/"],
        namespaces: [ACME],
        propertyKinds: ["object" as const],
        instanceOf: [`${ACME}Person`],
        deprecated: "exclude" as const,
        fields: ["label" as const],
      },
      page: 2,
    }
    const base = new URLSearchParams({ workspace: "ws", pane: "search", q: "old", page: "9" })

    const written = writeAdvancedSearch(base, state)

    expect(written.get("workspace")).toBe("ws")
    expect(written.get("pane")).toBe("search")
    expect(readAdvancedSearch(written)).toEqual(state)
  })

  it("ignores unknown values and treats deprecated=include as no filter", () => {
    const state = readAdvancedSearch(
      new URLSearchParams("type=class,bogus&propertyKind=nope&deprecated=include&page=-3&fields=")
    )

    expect(state).toEqual({
      query: "",
      filters: {
        types: ["class"],
        definedBy: undefined,
        namespaces: undefined,
        propertyKinds: undefined,
        instanceOf: undefined,
        deprecated: undefined,
        fields: undefined,
      },
      page: 0,
    })
  })

  it("builds API params with paging, facets and repeated IRI filters", () => {
    const params = toSearchApiParams(
      { query: " loan ", filters: { definedBy: ["urn:a", "urn:b"], types: ["individual"] }, page: 3 },
      { pageSize: 25, workspace: "ws", facets: true }
    )

    expect(params.get("q")).toBe("loan")
    expect(params.getAll("definedBy")).toEqual(["urn:a", "urn:b"])
    expect(params.get("type")).toBe("individual")
    expect(params.get("offset")).toBe("75")
    expect(params.get("limit")).toBe("25")
    expect(params.get("facets")).toBe("true")
    expect(params.get("workspace")).toBe("ws")
  })
})

describe("filter toggles", () => {
  it("adds and removes facet values, dropping empty lists", () => {
    const added = toggleFacetValue({}, "namespace", ACME)
    expect(added.namespaces).toEqual([ACME])
    expect(isFacetValueSelected(added, "namespace", ACME)).toBe(true)

    const removed = toggleFacetValue(added, "namespace", ACME)
    expect(removed.namespaces).toBeUndefined()
  })

  it("toggles the deprecated choice on and back off", () => {
    const only = toggleFacetValue({}, "deprecated", "only")
    expect(only.deprecated).toBe("only")
    expect(toggleFacetValue(only, "deprecated", "exclude").deprecated).toBe("exclude")
    expect(toggleFacetValue(only, "deprecated", "only").deprecated).toBeUndefined()
  })

  it("unchecking a field from the unrestricted state keeps the others", () => {
    const withoutComments = toggleField({}, "comment")
    expect(withoutComments.fields).toEqual(["label", "alias"])
    // Re-checking it brings back the unrestricted state.
    expect(toggleField(withoutComments, "comment").fields).toBeUndefined()
  })

  it("counts each selected value, and the field restriction once", () => {
    expect(countActiveFilters({})).toBe(0)
    expect(
      countActiveFilters({ types: ["class", "property"], deprecated: "only", fields: ["label", "alias"] })
    ).toBe(4)
  })
})
