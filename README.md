# ACME Ontology Workbench

Three-pane web app for searching, browsing, and visualizing an OWL2 ontology stored in GraphDB.

## Features (Phase 1)
- Snappy full-text search (Typesense/Meilisearch or GraphDB FTS)
- Type hierarchy navigator (left)
- Diagram or search results in the center
- Entity details (right)
- Read-only APIs (NestJS) with workspace awareness

## Req discussions
https://chatgpt.com/c/68f60331-dfa0-8332-8fc4-7d8645e90403 (not needed for development, and not accessible)

## Quick Start

### Docker (Full Stack)
1. Copy `.env.example` to `.env` in `infra/` and adjust values.
2. To use GraphDB (11.5.2), place your license at `infra/graphdb/license/graphdb.license`
   (GraphDB 11 needs one even for the Free edition; the file is gitignored), and set
   `BACKEND_SPARQL_DRIVER=graphdb` and `GRAPHDB_ENDPOINT=http://graphdb:7200/repositories/acme` in `infra/.env`.
3. Run `make up` from the project root. The `graphdb-init` service creates the `acme`
   repository (no inference) and loads the fixtures on first start; `make graphdb-reset` recreates it.
4. Open http://localhost:3000

### Hybrid Development (Recommended for Frontend)
Run backend & infra in Docker, but frontend locally for HMR.
1. Run `make up` from the root.
2. Stop the dockerized frontend: `docker compose -f infra/docker-compose.yml stop frontend`
3. Start local frontend:
   ```bash
   cd packages/frontend
   pnpm dev
   ```

### Manual
- **Backend**: `cd packages/backend && cp .env.example .env && pnpm i && pnpm start:dev`
- **Frontend**: `cd packages/frontend && cp .env.example .env && pnpm i && pnpm dev`
- Ensure GraphDB, Typesense/Meili, and Redis are running per `infra/docker-compose.yml`.

## Repos & Workspaces
Monorepo using PNPM workspaces:
- `packages/frontend`
- `packages/backend`
- `packages/shared`

You can spin out packages later with minimal change.