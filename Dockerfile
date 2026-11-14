# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:25-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:25-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="maxima-mcp" \
      org.opencontainers.image.description="Enterprise MCP server for Maxima (computer algebra system)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/maxima-project/maxima-mcp"

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        maxima \
        maxima-doc \
        maxima-src \
        maxima-share \
        gnuplot-nox \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY README.md LICENSE ./

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin mcp \
    && mkdir -p /home/mcp/.cache/maxima-mcp \
    && chown -R mcp:mcp /app /home/mcp

ENV NODE_ENV=production \
    MAXIMA_MCP_TRANSPORT=http \
    MAXIMA_MCP_HOST=0.0.0.0 \
    MAXIMA_MCP_PORT=7331 \
    MAXIMA_MCP_CACHE_DIR=/home/mcp/.cache/maxima-mcp \
    MAXIMA_MCP_LOG_FORMAT=json

USER mcp
EXPOSE 7331

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:7331/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
