# Security Policy

## Supported versions

Security fixes are provided for the latest 1.x release.

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

Report privately to the maintainers with:

- affected version or commit,
- reproduction steps or a proof of concept,
- impact assessment,
- suggested mitigation if known.

You should receive an acknowledgement within a few business days. We will coordinate a fix and a
disclosure timeline with you.

## Important context

`maxima-mcp` executes Maxima expressions by design. Safe mode blocks common shell and file-system
primitives, but it is **not a sandbox**. Do not expose the server to untrusted users without running
it in an isolated container or VM with no credentials and strict resource limits. See
[`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model and deployment checklist.
