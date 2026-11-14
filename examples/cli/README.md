# AI CLI example configs

Each file uses `/ABS/PATH/maxima-mcp` as a placeholder. Replace it with the absolute path to your
checkout before use.

| File                      | Client              | Typical destination                                             |
| ------------------------- | ------------------- | --------------------------------------------------------------- |
| `opencode.jsonc`          | OpenCode V2         | `~/.config/opencode/opencode.jsonc` or project `opencode.jsonc` |
| `claude-code.mcp.json`    | Claude Code         | project `.mcp.json`                                             |
| `codex-config.toml`       | OpenAI Codex CLI    | `~/.codex/config.toml` or `.codex/config.toml`                  |
| `gemini-settings.json`    | Gemini CLI          | `~/.gemini/settings.json` or `.gemini/settings.json`            |
| `cursor-mcp.json`         | Cursor / Cursor CLI | `~/.cursor/mcp.json` or `.cursor/mcp.json`                      |
| `copilot-mcp-config.json` | GitHub Copilot CLI  | `~/.copilot/mcp-config.json` or project `.mcp.json`             |
| `crushrc`                 | Crush               | `~/.config/crush/crushrc` or `./.crushrc`                       |

See [`../../docs/AI_CLI_TUTORIAL.md`](../../docs/AI_CLI_TUTORIAL.md) for commands, HTTP variants,
verification steps, prompting guidance and troubleshooting.
