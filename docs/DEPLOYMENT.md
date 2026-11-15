# Deployment

## Docker

The included `Dockerfile` builds a multi-stage image with Maxima, documentation, source, share
packages and gnuplot preinstalled.

```bash
docker build -t maxima-mcp:1.1.0 .
docker run --rm \
  -p 127.0.0.1:7331:7331 \
  -e MAXIMA_MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -v maxima-mcp-cache:/home/mcp/.cache/maxima-mcp \
  maxima-mcp:1.1.0
```

Key properties:

- runs as non-root user `mcp` (UID 10001),
- HTTP transport on port 7331,
- `HEALTHCHECK` against `/healthz`,
- persistent cache volume for compiled share packages,
- no secrets baked into the image.

### Docker Compose

```bash
export MAXIMA_MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
docker compose up --build -d
docker compose logs -f
```

`docker-compose.yml` publishes the port on loopback by default. Remove the `127.0.0.1:` prefix only
after enabling TLS and authentication.

## Environment

Minimum production settings:

```bash
MAXIMA_MCP_TRANSPORT=http
MAXIMA_MCP_HOST=0.0.0.0
MAXIMA_MCP_PORT=7331
MAXIMA_MCP_AUTH_TOKEN=<32+ random bytes, hex/base64>
MAXIMA_MCP_ALLOWED_HOSTS=mcp.example.com
MAXIMA_MCP_CORS_ORIGINS=https://app.example.com
MAXIMA_MCP_LOG_FORMAT=json
MAXIMA_MCP_LOG_LEVEL=info
MAXIMA_MCP_MAX_SESSIONS=8
MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000
# Only when requests arrive through a trusted reverse proxy:
# MAXIMA_MCP_TRUST_PROXY=true
```

Do not expose the container port directly to the public internet; terminate TLS at a reverse proxy.
The MCP endpoint uses Bearer authentication and supports SSE; ensure the proxy does not buffer
streaming responses.

## Reverse proxy

Example nginx snippet:

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.com;

    ssl_certificate     /etc/ssl/certs/mcp.example.com.pem;
    ssl_certificate_key /etc/ssl/private/mcp.example.com.key;

    client_max_body_size 2m;

    location /mcp {
        proxy_pass http://127.0.0.1:7331;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:7331;
        proxy_set_header Host $host;
    }
}
```

Set `MAXIMA_MCP_ALLOWED_HOSTS=mcp.example.com` so host validation accepts proxied requests.

## systemd

```ini
[Unit]
Description=Maxima MCP Server
After=network.target

[Service]
Type=simple
User=maxima-mcp
Group=maxima-mcp
WorkingDirectory=/opt/maxima-mcp
EnvironmentFile=/etc/maxima-mcp.env
ExecStart=/usr/bin/node /opt/maxima-mcp/dist/index.js
Restart=on-failure
RestartSec=3
LimitNOFILE=65535

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/cache/maxima-mcp
MemoryMax=4G
CPUQuota=400%

[Install]
WantedBy=multi-user.target
```

`/etc/maxima-mcp.env`:

```bash
MAXIMA_MCP_TRANSPORT=http
MAXIMA_MCP_HOST=127.0.0.1
MAXIMA_MCP_PORT=7331
MAXIMA_MCP_AUTH_TOKEN=...
MAXIMA_MCP_CACHE_DIR=/var/cache/maxima-mcp
```

## Kubernetes

The server keeps MCP HTTP sessions and Maxima sessions **in memory**. Consequences:

- A single replica is the simplest correct deployment.
- With multiple replicas, use sticky sessions at the ingress (keyed by `Mcp-Session-Id`) and be
  aware that a pod restart loses sessions and Maxima state.
- Do not scale by request count alone; each replica can start up to `MAXIMA_MCP_MAX_SESSIONS`
  Maxima processes.

Suggested probes:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 7331 }
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /readyz, port: 7331 }
  initialDelaySeconds: 5
  periodSeconds: 10
```

Resource guidance:

- Base Node process: ~100–250 MB.
- Documentation index: ~100–200 MB once built.
- Source index: ~50–150 MB.
- Each idle Maxima process: ~30–80 MB (more with packages loaded).
- CPU spikes during share-package compilation and heavy integrals.

Set requests/limits accordingly and consider disabling prewarm (`MAXIMA_MCP_DOCS_PREWARM=false`) on
memory-constrained replicas; tools will build indexes on first use.

## Observability

- Structured JSON logs on stderr.
- Prometheus scrape target: `GET /metrics` with the bearer token if configured.
- Readiness reflects whether the Maxima binary is available, not whether indexes are built.
- `maxima_system_info` is available through MCP for client-side diagnostics.

Suggested alerts:

- `rate(maxima_mcp_evaluations_total{status="timeout"}[5m]) > 0.1`
- `maxima_mcp_sessions == maxima_mcp_sessions_busy` for extended periods
- sustained growth of `maxima_mcp_http_sessions`
- `up == 0` for the scrape target

## Upgrades and rollback

- The container image is self-contained; roll back by deploying the previous tag.
- Sessions and Maxima state are not persisted across restarts. Clients should re-open sessions and
  reload packages after an upgrade.
- The cache volume is safe to keep; delete it to force recompilation of share packages.
- Configuration is validated at startup, so a bad environment fails fast rather than serving
  partially configured.

## Health endpoint reference

| Endpoint   | Meaning                                           |
| ---------- | ------------------------------------------------- |
| `/healthz` | Process is alive                                  |
| `/readyz`  | Maxima binary is available; returns 503 otherwise |
| `/metrics` | Prometheus text exposition                        |
| `/`        | Server name, version and endpoint map             |
