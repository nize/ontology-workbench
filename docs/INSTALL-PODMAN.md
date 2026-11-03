# Getting started: Ontology Workbench on rootless Podman

Ontology Workbench is a browser UI for exploring an ontology stored in GraphDB.
You run two containers and connect them to a GraphDB you already have.

```
Browser ──> your reverse proxy ──> frontend :3000 ──> backend :4000 ──> your GraphDB
```

- Only the frontend is exposed. It forwards `/api` requests to the backend.
- The containers store no data, so no volumes or backups are needed.

> **The app has no login of its own.** Put it behind your reverse proxy with TLS
> and SSO. Do not expose it directly.

## What you need

| | |
|---|---|
| Podman | Rootless, version 4.4 or later for the Quadlet setup below |
| GraphDB | Tested with 11.5.2 |
| Network | The backend container can reach GraphDB's HTTP port (7200 by default) |

**GraphDB repository**

- The app only reads, so a read-only GraphDB user is enough.
- Use a repository **without inference** (the `empty` ruleset). With inference,
  transitive `rdfs:subClassOf` results flatten the type tree.
- The type tree shows resources typed `owl:Class` or `rdfs:Class`, arranged by
  `rdfs:subClassOf` and named by `rdfs:label`.

## 1. Get the images

| Image | Version |
|---|---|
| `ghcr.io/nize/ontology-workbench-backend` | `0.2.0` |
| `ghcr.io/nize/ontology-workbench-frontend` | `0.2.0` |

Always use both images from the same version. They are public, for
`linux/amd64` and `linux/arm64`. To use an internal registry, copy them there
(`--all` keeps the digests unchanged):

```bash
skopeo copy --all \
  docker://ghcr.io/nize/ontology-workbench-backend:0.2.0 \
  docker://<your-registry>/ontology-workbench-backend:0.2.0
```

Repeat for the frontend, then use your registry path in the steps below. Image
digests, SBOMs and scan reports are on the
[release page](https://github.com/nize/ontology-workbench/releases).

## 2. Configure

| Container | Setting | Value |
|---|---|---|
| backend | `GRAPHDB_ENDPOINT` | **Required.** `http://<host>:7200/repositories/<repository-id>` |
| backend | `GRAPHDB_AUTH_BASIC` | `user:password`, if GraphDB has security enabled. Store it as a secret. |
| backend | `REQUEST_TIMEOUT_MS` | Optional timeout for GraphDB requests |
| backend | `NODE_EXTRA_CA_CERTS` | Path to a mounted CA file, if GraphDB's HTTPS certificate uses a private CA |
| frontend | `BACKEND_URL` | `http://ontology-backend:4000` |

Leave `DEFAULT_WORKSPACE` unset. If you set it, it must be a full graph IRI;
a plain name such as `main` breaks the queries.

**Reaching GraphDB from the container:** use its normal hostname. If it runs on
the same host, use `host.containers.internal`. If it runs under the same Podman
user, you can instead attach the backend to GraphDB's network.

### Serving under a path prefix (optional)

The published frontend image serves the app from `/`. To serve it below a
prefix on a shared hostname, such as `https://tools.example.com/ow`, build your
own frontend image from the release tag. Next.js fixes the prefix at build
time, so it cannot be set when the container starts.

```bash
git clone --branch v0.2.0 https://github.com/nize/ontology-workbench.git
cd ontology-workbench
podman build --format docker --build-arg BASE_PATH=/ow \
  -f packages/frontend/Dockerfile -t <your-registry>/ontology-workbench-frontend:0.2.0-ow .
```

- `BASE_PATH` must start with `/` and must not end with `/`.
- Use the published backend image as usual. It needs no prefix.
- Your reverse proxy must forward `/ow/...` to the frontend **unchanged**. Do
  not strip the prefix.
- Everything moves under the prefix, including the API: in the commands below,
  `/api/...` becomes `/ow/api/...`, and the frontend health check fetches
  `http://127.0.0.1:3000/ow`.
- Your own build is not covered by our signatures and attestations, so scan it
  in your pipeline as you do for other images.

## 3. Run

### Try it quickly

```bash
podman network create ontology-workbench

printf '%s' 'graphdb-user:graphdb-password' | podman secret create ow-graphdb-auth -

podman run -d --name ontology-backend --network ontology-workbench \
  -e GRAPHDB_ENDPOINT=http://graphdb.example.internal:7200/repositories/my-repo \
  --secret ow-graphdb-auth,type=env,target=GRAPHDB_AUTH_BASIC \
  --read-only \
  ghcr.io/nize/ontology-workbench-backend:0.2.0

podman run -d --name ontology-frontend --network ontology-workbench \
  -e BACKEND_URL=http://ontology-backend:4000 \
  -p 127.0.0.1:8080:3000 \
  ghcr.io/nize/ontology-workbench-frontend:0.2.0
```

Leave out the `--secret` line if GraphDB has no security enabled.

### Run it as a service (Quadlet)

If your pipeline already manages containers its own way, use the settings above
and skip this section. Otherwise create these three files in
`~/.config/containers/systemd/`.

`ontology-workbench.network`

```ini
[Network]
NetworkName=ontology-workbench
```

`ontology-backend.container`

```ini
[Unit]
Description=Ontology Workbench backend

[Container]
Image=ghcr.io/nize/ontology-workbench-backend:0.2.0
ContainerName=ontology-backend
Network=ontology-workbench.network
Environment=GRAPHDB_ENDPOINT=http://graphdb.example.internal:7200/repositories/my-repo
Secret=ow-graphdb-auth,type=env,target=GRAPHDB_AUTH_BASIC
ReadOnly=true
HealthCmd=["/nodejs/bin/node","-e","fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
HealthInterval=30s

[Service]
Restart=always

[Install]
WantedBy=default.target
```

`ontology-frontend.container`

```ini
[Unit]
Description=Ontology Workbench frontend
Requires=ontology-backend.service
After=ontology-backend.service

[Container]
Image=ghcr.io/nize/ontology-workbench-frontend:0.2.0
ContainerName=ontology-frontend
Network=ontology-workbench.network
Environment=BACKEND_URL=http://ontology-backend:4000
PublishPort=127.0.0.1:8080:3000
HealthCmd=["/nodejs/bin/node","-e","fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
HealthInterval=30s

[Service]
Restart=always

[Install]
WantedBy=default.target
```

The images have no shell, so a health check must use the JSON array form shown
above. Start the services, and keep them running after logout:

```bash
loginctl enable-linger $USER
systemctl --user daemon-reload
systemctl --user start ontology-frontend.service
```

## 4. Check that it works

```bash
# The backend is running
curl -s http://127.0.0.1:8080/api/healthz

# The backend can read your GraphDB repository
curl -s 'http://127.0.0.1:8080/api/types/tree?depth=1'
```

The first returns `{"status":"ok",...}`. The second returns your top-level
classes as JSON. Then point your reverse proxy at port 8080 and open the app.
With a path prefix, add it to both URLs, e.g. `/ow/api/healthz`.

`/api/healthz` only shows that the backend is running. It stays OK when GraphDB
is unreachable, so use the second command to test the connection.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Backend exits at start with `GRAPHDB_ENDPOINT is required` | The setting is missing |
| `/api/healthz` returns 502 | The frontend cannot reach the backend. Check `BACKEND_URL` and that both are on the same network. |
| `/api/types/tree` returns 500 | Wrong repository id, wrong credentials, or GraphDB unreachable. See the backend logs. |
| `/api/types/tree` returns `[]` | The repository has no classes the app recognizes, or is empty |
| Type tree looks flat | The repository uses inference. Use the `empty` ruleset. |
| Page or styles return 404 behind the proxy | The prefix does not match: the image was built with a different `BASE_PATH`, or the proxy strips the prefix |

Logs: `podman logs ontology-backend`, or
`journalctl --user -u ontology-backend` when running as a service. The images
have no shell, so `podman exec ... sh` does not work.

## Upgrading

Change both image versions, then restart. There is nothing to migrate.

```bash
systemctl --user daemon-reload
systemctl --user restart ontology-frontend.service ontology-backend.service
```
