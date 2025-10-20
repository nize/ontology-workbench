# Agents: How to Work Here

## Inputs you should rely on
- `docs/CONTEXT.md` for business context
- `docs/ARCHITECTURE.md` for boundaries and interfaces
- Ticket specs in `tasks/` with acceptance criteria and API contracts

## Output we expect per ticket
- Minimal viable code to meet acceptance criteria
- Tests and local run instructions
- Update README(s) where relevant
- Small, atomic PRs referencing the ticket id (e.g., FE-002)

## Rules of Engagement
- Do not change public API contracts without a ticket.
- Keep shared types in `packages/shared`.
- Prefer dependency inversion (ports/adapters) for SPARQL/search.
- Log structured errors; don’t swallow failures.

## Coding Standards
- TypeScript strict mode
- Lint + Prettier pass in CI
- Commit style: Conventional Commits
- Tests: at least happy-path + 1 edge case

## How to build & test (quick)
- Build everything: `pnpm build`
- Unit tests (all packages): `pnpm test:unit`
- E2E/API tests: `pnpm test:e2e`
- Coverage (unit): `pnpm coverage`

> Write new tests next to code:
> - Backend: `packages/backend/src/**/__tests__/*.test.ts` (Vitest)
> - Frontend: `packages/frontend/src/**/__tests__/*.test.tsx` (Vitest + React Testing Library)
> - E2E: `packages/backend/e2e/*.spec.ts` (Supertest) or `packages/frontend/e2e/*.spec.ts` (Playwright)