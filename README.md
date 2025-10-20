# ACME Ontology Workbench

Three-pane web app for searching, browsing, and visualizing an OWL2 ontology stored in GraphDB.

## Features (Phase 1)
- Snappy full-text search (Typesense/Meilisearch or GraphDB FTS)
- Type hierarchy navigator (left)
- Diagram or search results in the center
- Entity details (right)
- Read-only APIs (NestJS) with workspace awareness

## Quick Start

### Docker (recommended)
1. Copy `.env.example` to `.env` in `infra/` and adjust values.
2. `make up`
3. Open http://localhost:3000

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