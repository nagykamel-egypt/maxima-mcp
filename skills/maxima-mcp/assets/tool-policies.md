# Per-client tool allowlists

The skill core is client-neutral and intentionally does not set an
`allowed-tools` frontmatter field, so a single copy works everywhere. Some
clients (for example Claude Code and Codex) accept an `allowed-tools` key in a
skill's frontmatter to restrict which MCP tools that skill may call.

Apply one of these overlays **only** on a per-client copy of the skill, and keep
the neutral core unchanged. Merge the chosen `allowed-tools` list into the
`SKILL.md` frontmatter of that copy.

## Read-only analyst

Allows inspection and documentation but no computation, plotting, or packages.

```json
[
  "maxima_system_info",
  "maxima_help",
  "maxima_search_docs",
  "maxima_examples",
  "maxima_list_symbols",
  "maxima_doc_sections",
  "maxima_doc_read",
  "maxima_doc_categories",
  "maxima_source",
  "maxima_search_source",
  "maxima_list_source_files",
  "maxima_read_source_file",
  "maxima_list_packages"
]
```

## Computing analyst

Read-only set plus computation, plotting, and session management.

```json
[
  "maxima_system_info",
  "maxima_help",
  "maxima_search_docs",
  "maxima_examples",
  "maxima_list_symbols",
  "maxima_doc_sections",
  "maxima_doc_read",
  "maxima_doc_categories",
  "maxima_source",
  "maxima_search_source",
  "maxima_list_source_files",
  "maxima_read_source_file",
  "maxima_list_packages",
  "maxima_eval",
  "maxima_batch",
  "maxima_solve",
  "maxima_differentiate",
  "maxima_integrate",
  "maxima_limit",
  "maxima_series",
  "maxima_simplify",
  "maxima_numeric",
  "maxima_matrix",
  "maxima_plot",
  "maxima_session_open",
  "maxima_session_list",
  "maxima_session_reset",
  "maxima_session_close"
]
```

## Power user

Computing set plus share-package loading.

```json
[
  "maxima_system_info",
  "maxima_help",
  "maxima_search_docs",
  "maxima_examples",
  "maxima_list_symbols",
  "maxima_doc_sections",
  "maxima_doc_read",
  "maxima_doc_categories",
  "maxima_source",
  "maxima_search_source",
  "maxima_list_source_files",
  "maxima_read_source_file",
  "maxima_list_packages",
  "maxima_eval",
  "maxima_batch",
  "maxima_solve",
  "maxima_differentiate",
  "maxima_integrate",
  "maxima_limit",
  "maxima_series",
  "maxima_simplify",
  "maxima_numeric",
  "maxima_matrix",
  "maxima_plot",
  "maxima_session_open",
  "maxima_session_list",
  "maxima_session_reset",
  "maxima_session_close",
  "maxima_package_load"
]
```

## Guidance

- Never grant tools beyond the role's need. `maxima_package_load` executes
  installed share code; allowlist it only where that risk is accepted.
- These lists do not enable `MAXIMA_MCP_ALLOW_DANGEROUS`; safe mode still
  applies on the server.
- Align the role policy with `references/enterprise.md` §8 (agent governance).
- Re-run `scripts/validate.mjs` after merging an overlay, and keep the merged
  copy clearly labelled as a role-specific variant.
