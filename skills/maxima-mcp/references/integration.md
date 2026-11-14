# Integration guide

This skill is portable across MCP-capable clients. It has two independent parts:

1. **The MCP server connection** — the client must be able to call the
   `maxima_*` tools.
2. **The skill installation** — the client must be able to load this `SKILL.md`
   and its references.

Configure both. A skill without a server can describe good practice but cannot
compute; a server without the skill still exposes the tools but loses the
operating discipline and verification contract.

## 1. Install the server

### From a release package

```bash
npm install -g https://github.com/nagykamel-egypt/maxima-mcp/releases/latest/download/maxima-mcp-1.0.0.tgz
maxima-mcp --version
```

Or install a local tarball:

```bash
npm install -g ./maxima-mcp-1.0.0.tgz
```

### From source

```bash
git clone https://github.com/nagykamel-egypt/maxima-mcp.git
cd maxima-mcp
npm ci
npm run build
node dist/index.js
```

The default transport is stdio, so running it directly waits for an MCP client
on stdin/stdout. Logs go to stderr.

### Docker

```bash
docker build -t maxima-mcp .
docker run --rm -p 127.0.0.1:7331:7331 \
  -e MAXIMA_MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  maxima-mcp
```

### System dependencies

| Dependency                   | Needed for                                 |
| ---------------------------- | ------------------------------------------ |
| Node.js >= 20.19             | Server runtime                             |
| Maxima >= 5.40               | All computation                            |
| `maxima-doc`                 | `maxima_help`, search, sections, resources |
| `maxima-src`, `maxima-share` | `maxima_source`, source search, packages   |
| gnuplot                      | `maxima_plot`                              |

Debian/Ubuntu:

```bash
sudo apt-get install maxima maxima-doc maxima-src maxima-share gnuplot
```

## 2. Install the skill

The skill directory is:

```text
skills/maxima-mcp/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Copy or symlink the whole directory into the location your client scans. The
client must discover `SKILL.md`; the `references/`, `scripts/`, and `assets/`
directories are loaded on demand.

| Client                      | Common project location               | Common user location                    |
| --------------------------- | ------------------------------------- | --------------------------------------- |
| OpenCode                    | `.opencode/skills/maxima-mcp/`        | `~/.config/opencode/skills/maxima-mcp/` |
| Claude Code                 | `.claude/skills/maxima-mcp/`          | `~/.claude/skills/maxima-mcp/`          |
| OpenAI Codex CLI            | `.codex/skills/maxima-mcp/`           | `~/.codex/skills/maxima-mcp/`           |
| Gemini CLI                  | `.gemini/skills/maxima-mcp/`          | `~/.gemini/skills/maxima-mcp/`          |
| Cursor                      | `.cursor/skills/maxima-mcp/`          | `~/.cursor/skills/maxima-mcp/`          |
| GitHub Copilot CLI          | `.github/skills/maxima-mcp/`          | Check your client version               |
| Generic Agent Skills client | Any directory it scans for `SKILL.md` | Any directory it scans                  |

Client versions differ. If your client does not support skills, paste the
relevant sections of `SKILL.md` into its project instructions (`AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, or equivalent) and
keep the references next to the project.

### OpenCode example

```bash
mkdir -p ~/.config/opencode/skills
ln -s "$PWD/skills/maxima-mcp" ~/.config/opencode/skills/maxima-mcp
```

Project-scoped:

```bash
mkdir -p .opencode/skills
ln -s "$PWD/skills/maxima-mcp" .opencode/skills/maxima-mcp
```

### Claude Code example

```bash
mkdir -p .claude/skills
cp -R skills/maxima-mcp .claude/skills/
```

### Codex example

```bash
mkdir -p ~/.codex/skills
cp -R skills/maxima-mcp ~/.codex/skills/
```

### Generic project instructions

If the client has no skill loader, add a short pointer to its instruction file:

```markdown
When the maxima MCP server is available, use the maxima-mcp skill at
`skills/maxima-mcp/SKILL.md`. Read its `references/` files as needed. Follow its
verification, session, error-recovery, and safety rules.
```

A ready-to-copy snippet is in `assets/AGENTS-snippet.md`.

## 3. Connect the MCP server

### Stdio, generic JSON

```json
{
  "mcpServers": {
    "maxima": {
      "command": "maxima-mcp",
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
        "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

From a local checkout:

```json
{
  "mcpServers": {
    "maxima": {
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
        "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

### Claude Desktop / Claude Code

`claude_desktop_config.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "maxima": {
      "command": "maxima-mcp"
    }
  }
}
```

### OpenCode

`~/.config/opencode/opencode.jsonc` or project `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "maxima": {
        "type": "local",
        "command": ["node", "/ABS/PATH/maxima-mcp/dist/index.js"],
        "environment": {
          "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
          "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
        },
        "codemode": false,
        "timeout": {
          "startup": 30000,
          "execution": 600000
        }
      }
    }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml` or `.codex/config.toml`:

```toml
[mcp_servers.maxima]
command = "node"
args = ["/ABS/PATH/maxima-mcp/dist/index.js"]
startup_timeout_sec = 30
tool_timeout_sec = 300

[mcp_servers.maxima.env]
MAXIMA_MCP_DEFAULT_TIMEOUT_MS = "60000"
MAXIMA_MCP_MAX_TIMEOUT_MS = "300000"
```

Remote HTTP alternative:

```toml
[mcp_servers.maxima]
url = "http://127.0.0.1:7331/mcp"
bearer_token_env_var = "MAXIMA_MCP_AUTH_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 300
```

### Gemini CLI

`~/.gemini/settings.json` or `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "maxima": {
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
        "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
      },
      "timeout": 300000,
      "trust": false
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "maxima": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
        "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "maxima": {
      "type": "stdio",
      "command": "maxima-mcp"
    }
  }
}
```

### GitHub Copilot CLI

`~/.copilot/mcp-config.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "maxima": {
      "type": "local",
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
        "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000"
      },
      "tools": ["*"]
    }
  }
}
```

### Crush

`~/.config/crush/crushrc` or `./.crushrc`:

```bash
mcp add maxima --command node --args /ABS/PATH/maxima-mcp/dist/index.js \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS 60000 \
  --env MAXIMA_MCP_MAX_TIMEOUT_MS 300000
```

### Remote Streamable HTTP

```json
{
  "mcpServers": {
    "maxima": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer ${MAXIMA_MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

Start the server:

```bash
MAXIMA_MCP_TRANSPORT=http \
MAXIMA_MCP_HOST=127.0.0.1 \
MAXIMA_MCP_PORT=7331 \
MAXIMA_MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
node dist/index.js
```

## 4. Configuration essentials

| Variable                          | Default                          | Use                                       |
| --------------------------------- | -------------------------------- | ----------------------------------------- |
| `MAXIMA_MCP_TRANSPORT`            | `stdio`                          | `stdio` or `http`.                        |
| `MAXIMA_BIN`                      | `maxima`                         | Maxima executable.                        |
| `MAXIMA_MCP_DEFAULT_TIMEOUT_MS`   | `30000`                          | Default per-call timeout.                 |
| `MAXIMA_MCP_MAX_TIMEOUT_MS`       | `300000`                         | Hard timeout cap.                         |
| `MAXIMA_MCP_MAX_SESSIONS`         | `8`                              | Concurrent Maxima processes.              |
| `MAXIMA_MCP_SESSION_IDLE_MS`      | `900000`                         | Idle session expiry.                      |
| `MAXIMA_MCP_ALLOW_DANGEROUS`      | `false`                          | Allow shell/file primitives. Leave false. |
| `MAXIMA_MCP_DOCS`                 | `true`                           | Enable manual tools.                      |
| `MAXIMA_MCP_DOC_DIR`              | `/usr/share/doc/maxima-doc/html` | HTML manual location.                     |
| `MAXIMA_MCP_SRC_DIR`              | auto-detected                    | Lisp source location.                     |
| `MAXIMA_MCP_SHARE_DIR`            | auto-detected                    | Share package location.                   |
| `MAXIMA_MCP_MAX_EXPRESSION_CHARS` | `100000`                         | Expression length limit.                  |
| `MAXIMA_MCP_MAX_COMMANDS`         | `50`                             | Batch size limit.                         |
| `MAXIMA_MCP_MAX_OUTPUT_CHARS`     | `200000`                         | Retained output per statement.            |
| `MAXIMA_MCP_MAX_PLOT_BYTES`       | `10000000`                       | Plot size limit.                          |
| `MAXIMA_MCP_HOST`                 | `127.0.0.1`                      | HTTP bind address.                        |
| `MAXIMA_MCP_PORT`                 | `7331`                           | HTTP port.                                |
| `MAXIMA_MCP_AUTH_TOKEN`           | —                                | Bearer token for `/mcp` and `/metrics`.   |
| `MAXIMA_MCP_ALLOWED_HOSTS`        | loopback                         | Comma-separated allowed `Host` values.    |
| `MAXIMA_MCP_CORS_ORIGINS`         | `*`                              | Comma-separated allowed origins.          |
| `MAXIMA_MCP_RATE_LIMIT`           | `120`                            | Requests per window per IP; `0` disables. |
| `MAXIMA_MCP_RATE_WINDOW_MS`       | `60000`                          | Rate-limit window.                        |
| `MAXIMA_MCP_LOG_LEVEL`            | `info`                           | `fatal`…`trace`, `silent`.                |
| `MAXIMA_MCP_LOG_FORMAT`           | `auto`                           | `json`, `pretty`, `auto`.                 |

See the server `README.md`, `.env.example`, and
[enterprise](enterprise.md) for the full set.

## 5. Smoke test

### Through the skill script

```bash
# stdio, using the release binary on PATH
node skills/maxima-mcp/scripts/smoke.mjs --command "maxima-mcp"

# stdio, local checkout
node skills/maxima-mcp/scripts/smoke.mjs --command "node /ABS/PATH/maxima-mcp/dist/index.js"

# HTTP
node skills/maxima-mcp/scripts/smoke.mjs \
  --http http://127.0.0.1:7331 \
  --token "$MAXIMA_MCP_AUTH_TOKEN"
```

The script checks health, initializes MCP, lists tools, calls
`maxima_system_info`, and evaluates a minimal expression.

### Through the agent

Ask the agent to call:

1. `maxima_system_info` — expect `maxima.available: true`.
2. `maxima_eval` with `{"expression": "integrate(x^2, x)"}` — expect `x^3/3`.
3. `maxima_help` with `{"symbol": "integrate"}` — expect a manual entry when
   docs are installed.
4. `maxima_session_open` with a test ID, then `maxima_session_close`.

If any step fails, use [errors](errors.md).

## 6. HTTP security checklist

- [ ] Bind to loopback or a private network unless public exposure is intended.
- [ ] Set a long random `MAXIMA_MCP_AUTH_TOKEN` (16+ characters; 32+ bytes is
      better).
- [ ] Terminate TLS at a reverse proxy; do not send bearer tokens over plain
      HTTP across an untrusted network.
- [ ] Set `MAXIMA_MCP_ALLOWED_HOSTS` to the public hostname.
- [ ] Restrict `MAXIMA_MCP_CORS_ORIGINS` to trusted origins.
- [ ] Keep `MAXIMA_MCP_ALLOW_DANGEROUS=false`.
- [ ] Set body, rate, and session limits appropriate to the workload.
- [ ] Disable proxy buffering for SSE responses.
- [ ] Scrape `/metrics` with the bearer token and alert on timeout/saturation.
- [ ] Run in a container/VM with no credentials and resource limits if users are
      untrusted.
- [ ] Remember that HTTP MCP sessions and Maxima sessions are in-memory; use
      sticky sessions or a single replica.

## 7. Troubleshooting checklist

| Symptom                 | Check                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Tools not listed        | Server command/args; client logs; `maxima-mcp --version`; restart the client.       |
| `MAXIMA_NOT_FOUND`      | `which maxima`; set `MAXIMA_BIN` to an absolute path.                               |
| Docs unavailable        | `maxima-doc` installed; `MAXIMA_MCP_DOC_DIR`; `docs.state` in `maxima_system_info`. |
| Source unavailable      | `maxima-src`/`maxima-share`; `MAXIMA_MCP_SRC_DIR`; `MAXIMA_MCP_SHARE_DIR`.          |
| Plot fails              | `gnuplot` installed; test `plot2d` in a terminal Maxima; check dimensions/range.    |
| First package load slow | Normal compilation; use a larger timeout; keep the cache volume.                    |
| Timeouts                | Reduce scope; add assumptions; split the batch; raise timeout deliberately.         |
| HTTP 401                | Bearer token missing or wrong.                                                      |
| HTTP 403                | Host or CORS allowlist.                                                             |
| HTTP 404 on `/mcp`      | Missing/expired `Mcp-Session-Id`; initialize a new session.                         |
| HTTP 429                | Rate limit; back off or adjust the limit.                                           |
| `/readyz` 503           | Maxima binary unavailable; fix install/`MAXIMA_BIN`.                                |
| Session vanished        | Idle expiry, LRU eviction, crash, or reset; reopen and rebuild state.               |

## 8. Compatibility notes

- The skill targets `maxima-mcp` 1.x tool names. If a future server renames a
  tool, map by capability and state the mapping.
- MCP protocol version negotiation is handled by the client and server. Use a
  current client; if initialization fails, check the client's MCP version
  support.
- The skill does not bundle Maxima or the server. It assumes the user has
  installed and connected them.
- The references are intentionally versioned with the skill. Re-run
  `scripts/validate.mjs` after editing.

## 9. Client discovery matrix

This table tracks which clients have been verified to discover and load the
skill and to call the server. "Verified" means the listed step was executed and
recorded, not merely that a config snippet exists.

| Client                      | Skill discovery | Tool call   | Config format                    | Status                                                            |
| --------------------------- | --------------- | ----------- | -------------------------------- | ----------------------------------------------------------------- |
| Generic MCP stdio           | —               | ✅ Verified | `mcpServers` JSON                | Smoke test via `scripts/smoke.mjs`.                               |
| Generic MCP Streamable HTTP | —               | ✅ Verified | `type: http` JSON                | Smoke test via `scripts/smoke.mjs`.                               |
| OpenCode                    | Config present  | ⚠️ Pending  | `opencode.jsonc` (`mcp.servers`) | Verified config shape only; run-time discovery not yet exercised. |
| Claude Code                 | Config present  | ⚠️ Pending  | `.mcp.json` / `.claude/skills`   | Pending runtime verification.                                     |
| Codex CLI                   | Config present  | ⚠️ Pending  | `config.toml` / `.codex/skills`  | Pending runtime verification.                                     |
| Gemini CLI                  | Config present  | ⚠️ Pending  | `settings.json`                  | Pending runtime verification.                                     |
| Cursor                      | Config present  | ⚠️ Pending  | `.cursor/mcp.json`               | Pending runtime verification.                                     |
| VS Code                     | Config present  | ⚠️ Pending  | `.vscode/mcp.json`               | Pending runtime verification.                                     |
| GitHub Copilot CLI          | Config present  | ⚠️ Pending  | `mcpServers` JSON                | Pending runtime verification.                                     |
| Crush                       | Config present  | ⚠️ Pending  | `crushrc`                        | Pending runtime verification.                                     |

### Verification procedure per client

For each client marked pending, record and update the matrix after:

1. Add the server (stdio or HTTP) and install the skill at the documented path.
2. Confirm the client lists the 29 `maxima_*` tools.
3. Confirm the skill is discovered and announced for a math request.
4. Run the §5 smoke calls through the client and confirm `x^3/3`.
5. Run `node scripts/eval.mjs emit` against the client and record the first two
   cases.

Client versions change discovery behavior, so record the client version in the
row when verified. Do not mark a client verified from documentation alone.
