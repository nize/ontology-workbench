# Architecture (Phase 1)

## Components
- **Frontend (Next.js + TS)**: 3-pane layout, Cytoscape + ELK for diagram.
- **Backend (NestJS)**: SPARQL client to GraphDB, search API proxy, tree materializer, entity details normalizer, diagram view model.
- **Search**: Typesense/Meilisearch (or GraphDB FTS). 
- **Infra**: docker-compose (GraphDB, Typesense/Meili, Redis, backend, frontend).

## Key APIs
- `GET /search?q=&type=&limit=&offset=`
- `GET /types/tree?root=&depth=&workspace=main`
- `GET /entities/:iri?workspace=main`
- `GET /diagram?center=&radius=1&workspace=main`

## Data Flow
GraphDB → Backend (SPARQL SELECT/CONSTRUCT) → Normalized JSON → Frontend.
Indexer job (backend) extracts labels/comments to search index.

## Workspaces
Read-only for now; `workspace=main` parameter is plumbed through so Phase 2 can activate.