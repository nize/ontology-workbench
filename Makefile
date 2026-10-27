build:
	pnpm build

test:
	pnpm test

test-unit:
	pnpm test:unit

test-e2e:
	pnpm test:e2e

coverage:
	pnpm coverage

up:
	docker compose -f infra/docker-compose.yml up -d

down:
	docker compose -f infra/docker-compose.yml down

logs:
	docker compose -f infra/docker-compose.yml logs -f

graphdb-init:
	infra/graphdb/init.sh

graphdb-reset:
	infra/graphdb/init.sh --reset

rebuild:
	docker compose -f infra/docker-compose.yml up -d --build