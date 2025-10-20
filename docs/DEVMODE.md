# Dev/Test SPARQL Backends

We target GraphDB in production. For dev/test we support **Fuseki** (docker) and **Oxigraph** (embedded).

## Why
- No license keys for local dev/CI
- Fast unit tests (embedded, no network)
- Deterministic fixtures for snapshots

## Backends

### 1) GraphDB (prod)
- Env: `BACKEND_SPARQL_DRIVER=graphdb`
- Uses HTTP SPARQL endpoint + repo id
- Reasoning: as configured in GraphDB

### 2) Fuseki (integration tests / local dev)
- Env: `BACKEND_SPARQL_DRIVER=fuseki`
- Docker service `fuseki` in `infra/docker-compose.yml`
- Dataset path: `infra/fuseki/ds/`
- Reasoning: none by default

### 3) Oxigraph (unit tests / offline)
- Env: `BACKEND_SPARQL_DRIVER=oxigraph`
- `OXI_PATH` optional; if omitted, runs in-memory
- Load fixtures from `packages/backend/fixtures/*.ttl`

## Contracts (do not break)

`GraphStore` port:
- `select(sparql: string, params?: Vars, workspace?: string): Promise<Row[]>`
- `construct(sparql: string, params?: Vars, workspace?: string): Promise<Quad[]>`
- `update(sparql: string, params?: Vars, workspace?: string): Promise<void>`

All adapters MUST:
- Support `workspace` via **named graph**.
- Enforce timeouts and surface errors with codes.

## Fixtures

Place minimal ontology slices in `packages/backend/fixtures/`:
- `schema.ttl` (classes, properties)
- `sample-data.ttl` (few individuals)
- Optional `materialized.ttl` (pre-reasoned triples for tests)

## Running locally

### Fuseki
```bash
cd infra
docker compose --profile fuseki up -d
# backend:
BACKEND_SPARQL_DRIVER=fuseki pnpm --filter @acme/backend dev

Oxigraph (in-memory)

# in another terminal
pnpm --filter @acme/backend test
# tests auto-load fixtures into an in-memory store

GraphDB

cd infra
docker compose up -d graphdb
BACKEND_SPARQL_DRIVER=graphdb pnpm --filter @acme/backend dev

Known differences
  • Reasoning (RDFS/OWL RL) in GraphDB is not replicated in Oxigraph/Fuseki by default.
  • SPARQL 1.1 Update is supported by all three; Oxigraph update coverage is good for our use cases.
