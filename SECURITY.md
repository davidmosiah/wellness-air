# Security Policy

## Reporting a vulnerability

If you find a security issue in `wellness-air`, please email **mosiahdavid@gmail.com** with details and a reproduction. Do not open a public issue.

We aim to acknowledge within 48 hours and provide a fix or mitigation timeline within 7 days.

## Scope

The project is local-first. The most relevant security surfaces are:

- Provider API tokens stored in env vars (never logged in plaintext).
- Local cache directory under `~/.wellness-air`.
- HTTP transport (`--http`) which binds to `127.0.0.1` by default and uses CORS.
- Outbound HTTP calls to the configured air-quality provider.

If you find leaks of tokens to logs, unintended HTTP responses on the local listener, or unexpected outbound destinations, please report them.

## Out of scope

- Vulnerabilities in upstream provider APIs (AirGradient, AirThings, PurpleAir, IQAir, Awair) — please report those to the upstream vendor.
- General MCP transport bugs — report to https://github.com/modelcontextprotocol/sdk.
