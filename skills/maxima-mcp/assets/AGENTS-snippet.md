# Maxima MCP skill pointer

When the Maxima MCP server is available and the task involves symbolic math,
numerical analysis, matrices, calculus, plotting, or Maxima documentation, load
the skill at:

```text
skills/maxima-mcp/SKILL.md
```

Follow its operating loop, verification standard, session rules, error recovery,
and safety controls. Load only the `references/` files needed for the current
task:

- `references/tools.md` for exact tool arguments and return shapes;
- `references/workflows.md` for end-to-end procedures;
- `references/maxima-language.md` for syntax and common traps;
- `references/verification.md` for independent checks;
- `references/errors.md` for error-code recovery;
- `references/cookbook.md` for copy-ready recipes;
- `references/integration.md` for client/server setup;
- `references/enterprise.md` for deployment and governance;
- `references/prompts.md` for prompt and report templates.

Do not bypass safe mode. Do not claim a result you have not verified. If the
server is not connected, stop and explain how to connect it.
