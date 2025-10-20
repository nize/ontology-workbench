# Testing Guide (short)

## Runners
- **Vitest** for unit/integration (both backend & frontend)
- **Supertest** for backend HTTP e2e (optional)
- **Playwright** for FE e2e (optional; can be added later)

## Commands (root)
- `pnpm test` — all tests
- `pnpm test:unit` — unit tests only
- `pnpm test:e2e` — e2e tests only
- `pnpm coverage` — unit coverage

## Backend conventions
- Unit tests: `packages/backend/src/**/__tests__/*.test.ts`
- E2E (HTTP): `packages/backend/e2e/*.spec.ts`
- Use `BACKEND_SPARQL_DRIVER=oxigraph` for fast tests (in-memory).
- Use `BACKEND_SPARQL_DRIVER=fuseki` + `docker compose --profile fuseki up -d` for integration.

## Frontend conventions
- Unit tests: `packages/frontend/src/**/__tests__/*.test.tsx`
- Prefer React Testing Library; mock network with MSW.

## Fixtures
- Place RDF `.ttl` files under `packages/backend/fixtures/`.