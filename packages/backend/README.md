# Backend (NestJS)

## Env
Create `.env`:

PORT=4000
GRAPHDB_ENDPOINT=http://graphdb:7200/repositories/acme
GRAPHDB_AUTH_BASIC=user:pass
SEARCH_ENGINE=typesense
TYPESENSE_HOST=typesense
TYPESENSE_PORT=8108
TYPESENSE_API_KEY=xyz
REDIS_HOST=redis
REDIS_PORT=6379
DEFAULT_WORKSPACE=main

## Dev

pnpm i
pnpm start:dev

## Commands
- `pnpm index:full` — rebuild full search index

## API

Every endpoint that returns labels or definitions (`/entities`, `/types/tree`, `/types/individuals`, `/search`, `/diagram`) accepts `lang=` — a BCP 47 tag, `en` when missing or malformed. Literals are picked in this order: exact tag, same primary language (`sv` ~ `sv-SE`), untagged, English, then any other.

- `GET /languages?workspace=` — language tags used on `rdfs:label`, `skos:prefLabel`, `skos:altLabel`, `rdfs:comment` and `skos:definition`, most used first, as `{ default, languages: [{ tag, count }] }`. Always includes `en`.
- `GET /entities/:iri?workspace=`
- `GET /types/tree?root=&depth=&workspace=` — returns a list of `TypeTreeNode` entries for the requested subtree. Multi-parent classes are duplicated under every parent (with a deterministic `primaryParent` marker), and each node exposes `hasChildren` plus `childCount` so callers can tell when the current depth omits descendants.
- `GET /search?q=&type=&limit=&offset=&workspace=` — full-text search with prefix/fuzzy matching and simple highlights.
  Optional metadata filters (values within one filter are OR-ed, filters are AND-ed):
  - `type` — `class`, `property`, `individual`; comma-separated or repeated
  - `definedBy` — `rdfs:isDefinedBy` IRI (repeat the param for several)
  - `namespace` — IRI namespace, i.e. the IRI up to its last `#` or `/` (repeatable)
  - `propertyKind` — `object`, `datatype`, `annotation`; comma-separated or repeated
  - `instanceOf` — class IRI an individual is a direct `rdf:type` of (repeatable)
  - `deprecated` — `include` (default), `exclude` or `only` (`owl:deprecated true`)
  - `fields` — limit matching to `label`, `alias` and/or `comment`
  - `facets=true` — also return `facets`: per-filter value counts, each counted with every other filter applied but not its own

  With filters or `facets=true`, an empty `q` browses all matching entities sorted by label; without them it returns no hits.

### Module responsibilities

- **Entities service**: resolves a single resource (IRI) into labels, properties, and related references for display or editing.
- **Types service**: materializes and caches the ontology class hierarchy, exposing tree-shaped results optimised for lazy-loading UI trees.