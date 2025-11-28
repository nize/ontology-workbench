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

- `GET /entities/:iri?workspace=`
- `GET /types/tree?root=&depth=&workspace=` — returns a list of `TypeTreeNode` entries for the requested subtree. Multi-parent classes are duplicated under every parent (with a deterministic `primaryParent` marker), and each node exposes `hasChildren` plus `childCount` so callers can tell when the current depth omits descendants.
- `GET /search?q=&type=&limit=&offset=&workspace=` — full-text search with prefix/fuzzy matching and simple highlights.

### Module responsibilities

- **Entities service**: resolves a single resource (IRI) into labels, properties, and related references for display or editing.
- **Types service**: materializes and caches the ontology class hierarchy, exposing tree-shaped results optimised for lazy-loading UI trees.