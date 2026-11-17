import { describe, expect, it } from "vitest"

import { DEFAULT_VOCABULARY, entityTypeLabel, restrictionQualifier, term } from "../lib/terms"

describe("terms", () => {
  it("defaults to plain wording", () => {
    expect(DEFAULT_VOCABULARY).toBe("plain")
  })

  it("words section titles per vocabulary", () => {
    expect(term("domain", "plain")).toBe("Applies to")
    expect(term("domain", "owl")).toBe("Domain")
    expect(term("individuals", "plain")).toBe("Items")
  })

  it("labels entity types, preferring the property kind", () => {
    expect(entityTypeLabel("class", "plain")).toBe("Type")
    expect(entityTypeLabel("class", "owl")).toBe("Class")
    expect(entityTypeLabel("property", "plain", "object")).toBe("Relationship")
    expect(entityTypeLabel("property", "owl", "datatype")).toBe("Datatype property")
    expect(entityTypeLabel("property", "owl")).toBe("Property")
  })

  it("phrases restrictions in plain words", () => {
    expect(restrictionQualifier({ kind: "some", property: "p", target: { type: "iri", value: "x" } })).toBe("at least one")
    expect(restrictionQualifier({ kind: "min", property: "p", cardinality: 2 })).toBe("at least 2")
    expect(restrictionQualifier({ kind: "exact", property: "p", cardinality: 1 })).toBe("exactly 1")
  })
})
