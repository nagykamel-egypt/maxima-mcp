# Using Maxima MCP with AI CLIs

A complete, copy-paste guide for connecting this Maxima MCP server to terminal AI agents:
**OpenCode**, **Claude Code**, **OpenAI Codex CLI**, **Gemini CLI**, **Cursor CLI**, **GitHub Copilot CLI**,
and **Crush** — plus generic JSON clients such as VS Code, Cline, Roo Code, Windsurf, Qwen Code and
Claude Desktop.

The examples assume the server lives at:

```text
/ABS/PATH/maxima-mcp
```

Replace `/ABS/PATH/maxima-mcp` with your checkout path. If you install the published package, you
can replace `node /ABS/PATH/maxima-mcp/dist/index.js` with `npx -y maxima-mcp` or a globally linked
`maxima-mcp` command.

## Contents

1. [Before you connect anything](#1-before-you-connect-anything)
2. [OpenCode](#2-opencode)
3. [Claude Code](#3-claude-code)
4. [OpenAI Codex CLI](#4-openai-codex-cli)
5. [Gemini CLI](#5-gemini-cli)
6. [Cursor CLI](#6-cursor-cli)
7. [GitHub Copilot CLI](#7-github-copilot-cli)
8. [Crush](#8-crush)
9. [Other clients](#9-other-clients)
10. [Running the server over HTTP](#10-running-the-server-over-http)
11. [Prompting playbook](#11-prompting-playbook)
12. [Non-interactive CLI examples](#12-non-interactive-cli-examples)
13. [Troubleshooting](#13-troubleshooting)
14. [Security checklist](#14-security-checklist-for-cli-users)
15. [Copy-paste config index](#15-copy-paste-config-index)

---

## 1. Before you connect anything

### 1.1 Build and verify the server

```bash
cd /ABS/PATH/maxima-mcp
npm ci
npm run build

node dist/index.js --version
node dist/index.js --help
```

Check the system dependencies:

```bash
maxima --version
gnuplot --version
test -f /usr/share/doc/maxima-doc/html/index.html && echo "docs OK"
```

If `maxima` works in your shell but not when launched by a desktop app, use an **absolute path** for
the server command and/or set `MAXIMA_BIN` to the absolute path of Maxima.

### 1.2 Run the server manually once

MCP servers use stdio by default and are normally started by the client. You can still run one
directly to see startup logs on stderr:

```bash
MAXIMA_MCP_LOG_FORMAT=pretty MAXIMA_MCP_LOG_LEVEL=debug node dist/index.js
```

Press `Ctrl+C` to stop it. A healthy startup logs the detected Maxima version and begins indexing
the manual/source tree in the background.

### 1.3 Pick a transport

| Transport           | Use it when                                                     | Notes                                                           |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| **stdio**           | The AI CLI runs on the same machine as Maxima                   | Simplest, no network/auth, recommended for local use            |
| **Streamable HTTP** | Multiple clients, containers, remote hosts, shared team service | Requires `MAXIMA_MCP_TRANSPORT=http` and ideally a bearer token |

All local examples below use stdio. Remote HTTP examples are collected in
[section 10](#10-running-the-server-over-http).

### 1.4 Recommended server environment

These are optional but make the agent experience more predictable:

```bash
MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000   # 60s for normal CAS work
MAXIMA_MCP_MAX_TIMEOUT_MS=300000       # cap at 5 minutes
MAXIMA_MCP_MAX_SESSIONS=8
MAXIMA_MCP_LOG_LEVEL=info
MAXIMA_MCP_ALLOW_DANGEROUS=false       # keep safe mode ON
```

For long-running symbolic work, raise the client's tool timeout as shown in each section. The
server's own timeout still applies.

### 1.5 The one prompt that verifies everything

After configuring a client, start a session and ask:

```text
Use maxima_system_info, then solve x^2 - 4 = 0 with Maxima and show the exact Maxima command.
```

A working setup returns Maxima 5.x, a healthy documentation/source index, and the roots `x = -2`,
`x = 2`. If the tools are missing, jump to [troubleshooting](#13-troubleshooting).

---

## 2. OpenCode

OpenCode V2 is configured under `mcp.servers` in `opencode.json` / `opencode.jsonc`. It watches the
config file and reloads automatically, so no restart is needed after editing.

> OpenCode V1 used a different shape (server names directly under `mcp`). These examples target
> current OpenCode V2; see the official migration guide if you are upgrading.

### 2.1 Add with the CLI (recommended)

Global, from any project:

```bash
opencode mcp add maxima --global -- node /ABS/PATH/maxima-mcp/dist/index.js
opencode mcp list
```

Project-local (run from the project root):

```bash
opencode mcp add maxima -- node /ABS/PATH/maxima-mcp/dist/index.js
```

With environment variables, repeat `--env` before the `--`:

```bash
opencode mcp add maxima --global \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000 \
  -- node /ABS/PATH/maxima-mcp/dist/index.js
```

### 2.2 Manual configuration

`~/.config/opencode/opencode.jsonc` (global) or `opencode.jsonc` in the project:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "maxima": {
        "type": "local",
        "command": ["node", "/ABS/PATH/maxima-mcp/dist/index.js"],
        "environment": {
          "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000",
          "MAXIMA_MCP_MAX_TIMEOUT_MS": "300000",
        },
        // Optional: expose tools directly instead of through Code Mode.
        // "codemode": false,
        "timeout": {
          "startup": 30000,
          "execution": 600000,
        },
      },
    },
  },
}
```

Remote HTTP variant:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "maxima": {
        "type": "remote",
        "url": "http://127.0.0.1:7331/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:MAXIMA_MCP_AUTH_TOKEN}",
        },
      },
    },
  },
}
```

### 2.3 Verify and use

```bash
opencode mcp list
```

Inside OpenCode, run `/mcps` to view connection state. Under the default Code Mode, tools are
grouped as `tools.maxima.*`; set `"codemode": false` if you want the native tool list.

Example session:

```text
Use the maxima server to compute the eigenvalues of matrix([2,1],[1,2]).
Use maxima_help first if you are unsure about syntax, and show the Maxima command.
```

### 2.4 Non-interactive

```bash
opencode run "Use the maxima tools to integrate x^2*exp(-x) from 0 to infinity and verify the result."
```

---

## 3. Claude Code

Claude Code supports local stdio and remote HTTP servers, with project, user and local scopes.

### 3.1 Add with the CLI

Global user scope:

```bash
claude mcp add --scope user --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000 \
  --transport stdio maxima -- node /ABS/PATH/maxima-mcp/dist/index.js
```

Project scope (writes a shared `.mcp.json`):

```bash
claude mcp add --scope project --transport stdio \
  maxima -- node /ABS/PATH/maxima-mcp/dist/index.js
```

Remote HTTP:

```bash
claude mcp add --scope user --transport http maxima \
  http://127.0.0.1:7331/mcp \
  --header "Authorization: Bearer $MAXIMA_MCP_AUTH_TOKEN"
```

### 3.2 Manual `.mcp.json`

Commit this at the project root for a team-shared server:

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
      "timeout": 300000
    }
  }
}
```

Remote HTTP entry:

```json
{
  "mcpServers": {
    "maxima": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "timeout": 300000
    }
  }
}
```

> `.mcp.json` servers are project-scoped and require approval in an interactive `claude` session the
> first time they are used. Run `claude` in the project and approve the server.

### 3.3 Verify and use

```bash
claude mcp list
claude mcp get maxima
```

Inside Claude Code, `/mcp` shows connection state, tool counts and authentication. Example:

```text
/mcp
Solve the system x + y = 5, x - y = 1 with maxima_solve,
then verify the solution numerically.
```

Startup/tool timeouts:

```bash
# Startup timeout for all servers (milliseconds)
MCP_TIMEOUT=30000 claude

# Per-server timeout is already set in .mcp.json via "timeout": 300000
```

For large expressions, Claude Code's output limit can be raised:

```bash
MAX_MCP_OUTPUT_TOKENS=50000 claude
```

### 3.4 Non-interactive

```bash
claude -p "Use the maxima tools to factor x^6 - 1 and verify the factorization by expansion."
```

If the run is not allowed to use MCP tools, approve them in an interactive session first or add the
appropriate permission rule for your environment.

---

## 4. OpenAI Codex CLI

Codex stores MCP servers in `~/.codex/config.toml` (user) or `.codex/config.toml` (trusted project).
The ChatGPT desktop app, Codex CLI and the IDE extension share this configuration.

### 4.1 Add with the CLI

```bash
codex mcp add maxima \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000 \
  -- node /ABS/PATH/maxima-mcp/dist/index.js

codex mcp list
```

Remote HTTP:

```bash
codex mcp add maxima --url http://127.0.0.1:7331/mcp
```

For bearer authentication, use `config.toml` (below) with `bearer_token_env_var`; it is clearer and
keeps the secret out of the file.

### 4.2 Manual `config.toml`

Local stdio:

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

Remote HTTP with a bearer token from the environment:

```toml
[mcp_servers.maxima]
url = "http://127.0.0.1:7331/mcp"
bearer_token_env_var = "MAXIMA_MCP_AUTH_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 300
```

Useful optional policies — add these inside the same `[mcp_servers.maxima]` table:

```toml
# default_tools_approval_mode = "prompt"
# enabled_tools = ["maxima_eval", "maxima_help", "maxima_plot"]
# disabled_tools = ["maxima_package_load"]
```

### 4.3 Verify and use

```bash
codex mcp list
```

Inside Codex, `/mcp` shows servers and tools. Example:

```text
Use maxima_help to check solve syntax, then solve x^3 - 6*x^2 + 11*x - 6 = 0
and verify each root by substitution.
```

### 4.4 Non-interactive

```bash
codex exec "Use the maxima tools to compute the determinant of matrix([1,2],[3,4]) and show the command."
```

---

## 5. Gemini CLI

> **Transition note:** Google announced that Gemini CLI was replaced by **Antigravity CLI** for
> unpaid/Google One users on June 18, 2026. If your installation still exposes the `gemini`
> command, the setup below applies. On Antigravity, use its MCP settings UI and the same stdio
> command/HTTP URL.

Gemini CLI reads `mcpServers` from `~/.gemini/settings.json` (user) or `.gemini/settings.json`
(project). It supports stdio, SSE and Streamable HTTP.

### 5.1 Add with the CLI

User scope:

```bash
gemini mcp add --scope user maxima node /ABS/PATH/maxima-mcp/dist/index.js
```

With environment variables:

```bash
gemini mcp add --scope user \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000 \
  maxima node /ABS/PATH/maxima-mcp/dist/index.js
```

Remote Streamable HTTP:

```bash
gemini mcp add --transport http maxima \
  http://127.0.0.1:7331/mcp \
  --header "Authorization: Bearer $MAXIMA_MCP_AUTH_TOKEN"
```

### 5.2 Manual `settings.json`

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

Remote Streamable HTTP:

```json
{
  "mcpServers": {
    "maxima": {
      "httpUrl": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "timeout": 300000
    }
  }
}
```

`trust: true` bypasses tool confirmation for this server. Keep it `false` unless you fully trust the
client and environment; the server's own safe mode still applies.

### 5.3 Verify and use

```bash
gemini mcp list
```

Inside Gemini CLI, `/mcp` shows connection status and tools. Example:

```text
/mcp
Use the maxima tools to compute the limit of sin(x)/x as x approaches 0,
then verify it numerically.
```

### 5.4 Non-interactive

```bash
gemini -p "Use maxima to integrate exp(-x^2) from 0 to infinity and explain the result."
```

---

## 6. Cursor CLI

Cursor CLI (`agent`) shares MCP configuration with the Cursor editor. Config lives at
`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project).

### 6.1 Manual configuration

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

Remote HTTP:

```json
{
  "mcpServers": {
    "maxima": {
      "url": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MAXIMA_MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

Cursor supports `${env:NAME}` interpolation in `command`, `args`, `env`, `url` and `headers`, so
secrets can stay in your shell environment.

### 6.2 Verify and use

```bash
agent mcp list
agent mcp list-tools maxima
```

Inside Cursor CLI, `/mcp list` shows the same view. Example:

```text
agent -p "Use the maxima tools to find the eigenvalues and eigenvectors of matrix([2,1],[1,2])."
```

MCP tools ask for approval by default. To auto-approve all MCP tools for a trusted run:

```bash
agent --approve-mcps "Use maxima to simplify (x^3 - 1)/(x - 1)."
```

---

## 7. GitHub Copilot CLI

Copilot CLI uses `~/.copilot/mcp-config.json` for user configuration, plus project-level `.mcp.json`
or `.github/mcp.json`.

### 7.1 Add with the CLI

```bash
copilot mcp add maxima -- node /ABS/PATH/maxima-mcp/dist/index.js
```

With environment variables:

```bash
copilot mcp add maxima \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS=60000 \
  -- node /ABS/PATH/maxima-mcp/dist/index.js
```

Remote HTTP:

```bash
copilot mcp add --transport http \
  --header "Authorization: Bearer $MAXIMA_MCP_AUTH_TOKEN" \
  maxima http://127.0.0.1:7331/mcp
```

### 7.2 Manual configuration

`~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "maxima": {
      "type": "local",
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000"
      },
      "tools": ["*"]
    }
  }
}
```

Remote HTTP:

```json
{
  "mcpServers": {
    "maxima": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "tools": ["*"]
    }
  }
}
```

Project-level `.mcp.json` supports the same `mcpServers` object. Copilot CLI loads project MCP
config only after you trust the directory.

### 7.3 Verify and use

```bash
copilot mcp list
copilot mcp get maxima
```

Inside Copilot CLI, `/mcp` opens the MCP dashboard; `/mcp show maxima` shows its tools. Example:

```text
Use the maxima tools to solve x^2 + 2*x + 5 = 0 and identify the complex roots.
```

---

## 8. Crush

Crush uses a `crushrc` file — Bash with Crush-specific builtins — at `~/.config/crush/crushrc` or
`./.crushrc` in a project.

### 8.1 Add with `crushrc`

```bash
# ~/.config/crush/crushrc
mcp add maxima --command node --args /ABS/PATH/maxima-mcp/dist/index.js \
  --env MAXIMA_MCP_DEFAULT_TIMEOUT_MS 60000
```

Remote HTTP:

```bash
mcp add maxima --type http --url http://127.0.0.1:7331/mcp \
  --header Authorization "Bearer $MAXIMA_MCP_AUTH_TOKEN"
```

`crushrc` is trusted shell code. Do not source untrusted files, and prefer environment variables or a
secret manager over hardcoded tokens.

### 8.2 Verify and use

Start `crush` in a project and inspect its MCP status in the UI. Then ask:

```text
Use the maxima server to expand (x + y)^4 and then substitute x = 1, y = 2.
```

Permissions are requested by default; approve only the Maxima tools you expect to use.

---

## 9. Other clients

### 9.1 Generic `mcpServers` JSON

Claude Desktop, Cline, Roo Code, Windsurf, Qwen Code (under `~/.qwen/settings.json`) and many other
clients accept:

```json
{
  "mcpServers": {
    "maxima": {
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"],
      "env": {
        "MAXIMA_MCP_DEFAULT_TIMEOUT_MS": "60000"
      }
    }
  }
}
```

For Qwen Code and Gemini-compatible forks, Streamable HTTP usually uses `httpUrl`:

```json
{
  "mcpServers": {
    "maxima": {
      "httpUrl": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### 9.2 VS Code

`.vscode/mcp.json` uses the `servers` key:

```json
{
  "servers": {
    "maxima": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"]
    }
  }
}
```

### 9.3 Claude Desktop

`claude_desktop_config.json` uses `mcpServers` with `command`, `args` and `env`:

```json
{
  "mcpServers": {
    "maxima": {
      "command": "node",
      "args": ["/ABS/PATH/maxima-mcp/dist/index.js"]
    }
  }
}
```

### 9.4 Quick reference

| Client                                         | Config location                                               | Local syntax                         | Verify                        |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| OpenCode                                       | `opencode.jsonc`, `~/.config/opencode/`                       | `mcp.servers.<name>` (`type: local`) | `opencode mcp list`, `/mcps`  |
| Claude Code                                    | `.mcp.json`, `~/.claude.json`                                 | `mcpServers.<name>`                  | `claude mcp list`, `/mcp`     |
| Codex CLI                                      | `~/.codex/config.toml`, `.codex/config.toml`                  | `[mcp_servers.<name>]`               | `codex mcp list`, `/mcp`      |
| Gemini CLI                                     | `~/.gemini/settings.json`, `.gemini/settings.json`            | `mcpServers.<name>`                  | `gemini mcp list`, `/mcp`     |
| Cursor CLI                                     | `~/.cursor/mcp.json`, `.cursor/mcp.json`                      | `mcpServers.<name>`                  | `agent mcp list`, `/mcp list` |
| Copilot CLI                                    | `~/.copilot/mcp-config.json`, `.mcp.json`, `.github/mcp.json` | `mcpServers.<name>`                  | `copilot mcp list`, `/mcp`    |
| Crush                                          | `~/.config/crush/crushrc`, `.crushrc`                         | `mcp add ...`                        | Crush MCP panel               |
| VS Code                                        | `.vscode/mcp.json`                                            | `servers.<name>`                     | MCP view                      |
| Claude Desktop / Cline / Roo / Windsurf / Qwen | app-specific JSON                                             | `mcpServers.<name>`                  | client MCP panel              |

---

## 10. Running the server over HTTP

Use HTTP when the CLI is remote, containerized, or shared between several clients.

### 10.1 Start the server

```bash
export MAXIMA_MCP_AUTH_TOKEN="$(openssl rand -hex 32)"

MAXIMA_MCP_TRANSPORT=http \
MAXIMA_MCP_HOST=127.0.0.1 \
MAXIMA_MCP_PORT=7331 \
MAXIMA_MCP_AUTH_TOKEN="$MAXIMA_MCP_AUTH_TOKEN" \
node /ABS/PATH/maxima-mcp/dist/index.js
```

The MCP endpoint is `http://127.0.0.1:7331/mcp`.

Verify:

```bash
curl -s http://127.0.0.1:7331/healthz
curl -s http://127.0.0.1:7331/readyz
curl -s -H "Authorization: Bearer $MAXIMA_MCP_AUTH_TOKEN" \
  http://127.0.0.1:7331/metrics | head
```

### 10.2 Client configuration

Use the remote snippets in the per-client sections. In every case the URL is:

```text
http://127.0.0.1:7331/mcp
```

and the header is:

```text
Authorization: Bearer <MAXIMA_MCP_AUTH_TOKEN>
```

For a public hostname, set `MAXIMA_MCP_ALLOWED_HOSTS` to that hostname and terminate TLS at a reverse
proxy. See [DEPLOYMENT.md](DEPLOYMENT.md).

### 10.3 HTTP security checklist

- Bind to `127.0.0.1` unless you are behind a trusted proxy.
- Always set `MAXIMA_MCP_AUTH_TOKEN` when the endpoint is reachable by others.
- Keep `MAXIMA_MCP_ALLOW_DANGEROUS=false`.
- Use explicit CORS origins in production (`MAXIMA_MCP_CORS_ORIGINS`).
- HTTP sessions and Maxima sessions are in memory; restarting the server loses them. Use sticky
  sessions if you run multiple replicas.

---

## 11. Prompting playbook

The MCP server gives the model 29 tools. You do not need to name a tool for every request, but
naming the task clearly and asking for verification produces much better results.

### 11.1 Suggested project instructions

Add this to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or a Cursor rule so the agent consistently uses
Maxima for math:

```markdown
For symbolic mathematics, use the `maxima` MCP server.

- Call `maxima_help` or `maxima_search_docs` before guessing Maxima syntax.
- Use the focused tools (`maxima_solve`, `maxima_differentiate`, `maxima_integrate`,
  `maxima_limit`, `maxima_series`, `maxima_simplify`, `maxima_numeric`, `maxima_matrix`) when they
  fit; use `maxima_eval` for everything else.
- Show the Maxima command you ran, not only the answer.
- Verify symbolic results numerically or by substitution when practical.
- Use `maxima_plot` for visualizations and report if gnuplot is unavailable.
- Keep multi-step work in one session so definitions persist; reset the session when starting
  unrelated work.
```

### 11.2 Task → tool map

| Task                                 | Preferred tool                          |
| ------------------------------------ | --------------------------------------- |
| Evaluate an expression               | `maxima_eval`                           |
| Several related statements           | `maxima_batch`                          |
| Solve equations/systems              | `maxima_solve`                          |
| Derivative                           | `maxima_differentiate`                  |
| Indefinite/definite/numeric integral | `maxima_integrate`                      |
| Limits                               | `maxima_limit`                          |
| Taylor series                        | `maxima_series`                         |
| Simplify/factor/expand               | `maxima_simplify`                       |
| Decimal or bigfloat value            | `maxima_numeric`                        |
| Determinant/eigenvalues/trace        | `maxima_matrix`                         |
| Plot 2D/3D                           | `maxima_plot`                           |
| Syntax and examples                  | `maxima_help`, `maxima_examples`        |
| Discover a function                  | `maxima_search_docs`                    |
| Inspect implementation               | `maxima_source`, `maxima_search_source` |
| Load a share package                 | `maxima_package_load`                   |
| Health/version                       | `maxima_system_info`                    |

### 11.3 Example prompts

**Calculus with verification**

```text
Compute ∫ x^2 e^(-x) dx from 0 to infinity with Maxima.
Show the exact command and result, then verify by differentiating and by a numerical check.
```

**Algebra and plotting**

```text
Solve x^3 - 6x^2 + 11x - 6 = 0.
Show the exact roots, verify each by substitution, and plot the polynomial on [-1, 5].
Use maxima_plot and include the image.
```

**Linear algebra**

```text
For matrix([[2,1],[1,2]]), compute the determinant, trace, eigenvalues and eigenvectors.
Check that the characteristic polynomial matches the eigenvalues.
```

**Manual and source research**

```text
Search the Maxima manual for functions that solve ordinary differential equations.
Summarize the most relevant functions, show one example from the manual,
and cite the manual sections.
```

**Debugging a hard computation**

```text
Integrate 1/(x^5 + 1) with Maxima. If it is slow, time a bounded attempt,
explain why it is expensive, and suggest a numerical alternative using maxima_integrate
with numerical=true.
```

**Multi-step session**

```text
Open a Maxima session named "calculus-demo".
Define f(x) := x^3 * sin(x) in that session.
Then, in the same session, compute f'(x), the indefinite integral of f, and a plot of f on [-2*pi, 2*pi].
Do not redefine f between steps.
```

### 11.4 Getting better answers

- Ask for **the Maxima command**, not just the final expression. This makes results auditable.
- Ask for **a numerical sanity check** for integrals, limits and roots.
- Mention assumptions explicitly (`assume(x > 0)`) or ask the agent to state them.
- Use `maxima_help` when a function has overloads or flags.
- Use a **named session** for related work; use `maxima_session_reset` for a clean slate.
- If a result looks wrong, ask the agent to re-run it with `maxima_batch` and show intermediate
  values.

---

## 12. Non-interactive CLI examples

These assume the client is configured and permitted to use MCP tools.

| Client      | One-shot command                                          |
| ----------- | --------------------------------------------------------- |
| OpenCode    | `opencode run "Use maxima to integrate x^2 from 0 to 1."` |
| Claude Code | `claude -p "Use maxima to integrate x^2 from 0 to 1."`    |
| Codex CLI   | `codex exec "Use maxima to integrate x^2 from 0 to 1."`   |
| Gemini CLI  | `gemini -p "Use maxima to integrate x^2 from 0 to 1."`    |
| Cursor CLI  | `agent -p "Use maxima to integrate x^2 from 0 to 1."`     |
| Copilot CLI | `copilot -p "Use maxima to integrate x^2 from 0 to 1."`   |

Non-interactive runs may have different tool-approval behavior. If a run reports no Maxima tools,
approve the server in an interactive session first.

---

## 13. Troubleshooting

### 13.1 The client does not list the Maxima tools

1. Verify the command by running it manually:
   ```bash
   node /ABS/PATH/maxima-mcp/dist/index.js --version
   ```
2. Use an **absolute path** to `node` and `dist/index.js` in the client config if the client is
   launched from a desktop environment with a minimal `PATH`.
3. Check the client's MCP status:
   - OpenCode: `opencode mcp list` or `/mcps`
   - Claude Code: `claude mcp list` or `/mcp`
   - Codex: `codex mcp list` or `/mcp`
   - Gemini: `gemini mcp list` or `/mcp`
   - Cursor: `agent mcp list` or `/mcp list`
   - Copilot: `copilot mcp list` or `/mcp`
4. Look at the server's stderr. Most clients expose MCP server logs; alternatively set
   `MAXIMA_MCP_LOG_LEVEL=debug` and `MAXIMA_MCP_LOG_FORMAT=pretty` in the server environment.

### 13.2 `MAXIMA_NOT_FOUND`

The client's environment does not have Maxima on `PATH`. Set:

```bash
MAXIMA_BIN=/absolute/path/to/maxima
```

in the server's `env` block. Confirm the path works:

```bash
/absolute/path/to/maxima --version
```

### 13.3 Documentation or source tools are unavailable

```bash
sudo apt-get install maxima-doc maxima-src maxima-share
```

or set `MAXIMA_MCP_DOC_DIR`, `MAXIMA_MCP_SRC_DIR`, `MAXIMA_MCP_SHARE_DIR`. The diagnostics tool
`maxima_system_info` reports which indexes are available.

### 13.4 A computation times out

- Raise the tool call's `timeout_ms` (up to `MAXIMA_MCP_MAX_TIMEOUT_MS`).
- Raise the client's tool timeout (Claude `timeout`, Codex `tool_timeout_sec`, Gemini `timeout`,
  OpenCode `timeout.execution`).
- After a timeout the Maxima process restarts and session definitions are lost; re-run setup
  statements in a single `maxima_batch`.
- Prefer `maxima_integrate` with `numerical: true` or `maxima_numeric` for hard integrals.

### 13.5 HTTP 401 / 403

- `401`: add `Authorization: Bearer <token>` to the client config and use the same token as
  `MAXIMA_MCP_AUTH_TOKEN`.
- `403`: the `Host` header is not allowed. Bind to loopback or add the public hostname to
  `MAXIMA_MCP_ALLOWED_HOSTS`.

### 13.6 Plot fails

```bash
sudo apt-get install gnuplot
```

Then test in a terminal:

```bash
maxima --very-quiet -q --batch-string='plot2d(sin(x), [x,-5,5], [gnuplot_term,"png"], [gnuplot_out_file,"/tmp/test.png"]);'
```

The MCP server's `maxima_plot` writes to a temporary file and returns an image; it never accepts a
user-supplied output path.

### 13.7 The first `maxima_package_load` is very slow

Some share packages with Lisp components compile on first use. The server keeps a persistent Maxima
userdir under its cache directory so builds survive restarts. Raise the tool timeout if needed:

```json
{ "package": "draw", "timeout_ms": 240000 }
```

### 13.8 Session state disappeared

A timeout, cancellation, crash or `maxima_session_reset` discards the session's process and all
definitions. Results report `restarted: true`. Use `maxima_session_list` to inspect sessions and
`maxima_session_reset` intentionally when starting unrelated work.

### 13.9 Docker/remote deployment

If the server runs in a container:

- The container must include Maxima, `maxima-doc`, `maxima-src`, `maxima-share` and gnuplot.
- Publish the HTTP port, set `MAXIMA_MCP_HOST=0.0.0.0`, and keep the host-side publish on loopback
  unless you have TLS and authentication.
- Use a persistent volume for `/home/mcp/.cache/maxima-mcp`.
- The official `Dockerfile` and `docker-compose.yml` in this repository are a good starting point.

---

## 14. Security checklist for CLI users

- Keep safe mode enabled (`MAXIMA_MCP_ALLOW_DANGEROUS=false`).
- Do not paste secrets into JSON configs; use environment interpolation where supported.
- Review client tool-approval prompts; Maxima expressions execute real code in a child process.
- Use stdio locally where possible. For HTTP, use a strong bearer token and TLS.
- Run untrusted users in a container/VM with resource limits; safe mode is not a sandbox.
- Keep the server and its dependencies updated.

For the full threat model, see [SECURITY.md](SECURITY.md).

---

## 15. Copy-paste config index

Ready-made files live in [`examples/cli/`](../examples/cli):

| File                      | Client                     |
| ------------------------- | -------------------------- |
| `opencode.jsonc`          | OpenCode V2                |
| `claude-code.mcp.json`    | Claude Code project config |
| `codex-config.toml`       | OpenAI Codex CLI           |
| `gemini-settings.json`    | Gemini CLI                 |
| `cursor-mcp.json`         | Cursor / Cursor CLI        |
| `copilot-mcp-config.json` | GitHub Copilot CLI         |
| `crushrc`                 | Crush                      |

Replace `/ABS/PATH/maxima-mcp` in each file before using it.
