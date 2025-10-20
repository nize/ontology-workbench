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