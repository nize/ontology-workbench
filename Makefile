up:
	cd infra && docker compose up -d --build

down:
	cd infra && docker compose down

logs:
	cd infra && docker compose logs -f backend frontend

reindex:
	cd packages/backend && pnpm index:full