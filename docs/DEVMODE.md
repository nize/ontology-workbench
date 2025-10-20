# Dev/Test SPARQL Backends

We target GraphDB in production. For dev/test we support **Fuseki** (docker) and **Oxigraph** (embedded).

## Why
- No license keys for local dev/CI
- Fast unit tests (embedded, no network)
- Deterministic fixtures for snapshots

## Env Vars

| Variable | Purpose |
| --- | --- |
| `BACKEND_SPARQL_DRIVER` | Selects `graphdb`, `fuseki`, or `oxigraph`. |
| `GRAPHDB_ENDPOINT` | HTTP endpoint for the GraphDB repository. |
| `GRAPHDB_AUTH_BASIC` | Optional `user:pass` for GraphDB basic auth. |
| `FUSEKI_ENDPOINT` | HTTP dataset endpoint (without `/query`). |
| `FUSEKI_AUTH_BASIC` | Optional `user:pass` for Fuseki basic auth. |
| `OXI_PATH` | Directory for Oxigraph persistence; omit for in-memory. |
| `REQUEST_TIMEOUT_MS` | Override per-request timeout (default 10000). |

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

### NestJS integration
- Import `GraphStoreModule.forRoot()` (or `.forRootAsync()`) inside the backend root module to expose the adapters via Nest's DI container.
- Inject `GraphStoreService` for the high-level port or use the `GRAPH_STORE` token when low-level adapter access is required.
- Customise instantiation by passing `env`/`createGraphStore` to `forRoot`, or return an env object from `forRootAsync`:

```ts
@Module({
  imports: [
    GraphStoreModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        BACKEND_SPARQL_DRIVER: config.get('BACKEND_SPARQL_DRIVER'),
        GRAPHDB_ENDPOINT: config.get('GRAPHDB_ENDPOINT'),
        FUSEKI_ENDPOINT: config.get('FUSEKI_ENDPOINT')
      })
    })
  ]
})
export class AppModule {}
```

## Contracts (do not break)

`GraphStore` port:
- `select(sparql: string, params?: Vars, workspace?: string): Promise<Row[]>`
- `construct(sparql: string, params?: Vars, workspace?: string): Promise<Quad[]>`
- `update(sparql: string, params?: Vars, workspace?: string): Promise<void>`

All adapters MUST:
- Support `workspace` via **named graph**.
- Enforce timeouts and surface errors with codes.

## Fixtures

We ship a tiny OWL2 dataset for dev/tests:

- `packages/backend/fixtures/acme-sample.ttl`

Backends should default tests to `BACKEND_SPARQL_DRIVER=oxigraph` (in-memory) and load this TTL into the active workspace graph. Integration tests may also import it into Fuseki when that profile is used.

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
