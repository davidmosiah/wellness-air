# Contributing

Thanks for poking at wellness-air. The fastest way to ship something useful here:

1. **File an issue first.** Even a 2-line description of the bug or wedge helps everyone.
2. **Branch from `main`**, name it `feat/<thing>` or `fix/<thing>`.
3. **Run `npm test`** before opening a PR. CI runs the same suite.
4. **Update the changelog** under `## [Unreleased]` in `CHANGELOG.md`.
5. **Open the PR** with a short summary of what changed and why.

## Picking something to work on

- Look at issues tagged `good first issue` or `help wanted`.
- The v0.2 roadmap (AirThings / PurpleAir / IQAir / Awair adapters) is wide open. See `AGENTS.md` for the recipe.
- Cross-connector ideas (e.g. `air_correlate_with_sleep`) are excellent.

## Code style

- TypeScript strict mode.
- `src/services/*` are pure helpers — no MCP-specific types.
- `src/tools/*` register MCP tools and orchestrate services.
- All tool responses go through `jsonResponse(payload)` so `structuredContent` stays consistent.

## License

By contributing you agree your changes are released under MIT.
