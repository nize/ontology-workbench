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

## Releases

Pushing a version tag (`git tag v0.1.0 && git push origin v0.1.0`) runs
`.github/workflows/release.yml`, which publishes multi-arch (amd64, arm64)
images to GitHub Container Registry:

- `ghcr.io/nize/ontology-workbench-backend:<version>`
- `ghcr.io/nize/ontology-workbench-frontend:<version>`

Nothing is pushed unless `scripts/security-scan.sh` passes for the source and
for every platform image. Run it locally before tagging:

```bash
scripts/security-scan.sh deps
```

Each image is signed with cosign (keyless, GitHub OIDC) and carries SBOM and
build-provenance attestations. To verify before use:

```bash
cosign verify ghcr.io/nize/ontology-workbench-backend:0.1.0 \
  --certificate-identity-regexp '^https://github.com/nize/ontology-workbench/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/nize/ontology-workbench-backend:0.1.0 --repo nize/ontology-workbench
```

The GitHub Release for each tag lists the image digests and attaches the SBOMs
and scan reports.

## Repos & Workspaces
Monorepo using PNPM workspaces:
- `packages/frontend`
- `packages/backend`
- `packages/shared`

You can spin out packages later with minimal change.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
