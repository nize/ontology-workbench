md
# BE-000A — Pluggable SPARQL Backends (GraphDB / Fuseki / Oxigraph)

## Goal
Introduce a `GraphStore` port and three concrete adapters so dev/test can run without GraphDB license/setup.

## Scope
- Define `GraphStore` interface (select/construct/update with named-graph parameter).
- Implement:
  - `GraphDBHttpRepository` (HTTP)
  - `FusekiRepository` (HTTP)
  - `OxigraphLocalRepository` (embedded; file or in-memory)
- Env-driven driver selection: `BACKEND_SPARQL_DRIVER=graphdb|fuseki|oxigraph`
- Common error/timeout handling; structured logs with latency

## Non-Goals
- No reasoning parity across backends (document differences)
- No migration of prod data

## Acceptance Criteria
- Unit tests run using Oxigraph (in-memory) with TTL fixtures.
- Integration tests run with Fuseki via docker compose profile.
- Switching drivers requires only env changes; APIs `/search`, `/types/tree`, `/entities/:iri`, `/diagram` behave identically on declared triples.
- README updated in `docs/DEVMODE.md`.

## Test Cases
- SELECT returns consistent rows from all drivers given the same fixtures.
- UPDATE inserts into a named graph (workspace) and is visible to subsequent SELECT.
- Timeouts and malformed queries return typed errors.

## Env Examples

BACKEND_SPARQL_DRIVER=oxigraph
OXI_PATH=.tmp/oxigraph-store
GRAPHDB_ENDPOINT=http://graphdb:7200/repositories/acme
FUSEKI_ENDPOINT=http://localhost:3030/acme
REQUEST_TIMEOUT_MS=10000
