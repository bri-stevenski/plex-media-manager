# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test               # run Vitest suite once (CI mode)
pnpm test:watch         # watch mode
pnpm test:coverage      # HTML + text coverage report
pnpm build              # tsc → dist/ + writes dist/package.json
pnpm lint               # ESLint on .ts/.js/.cjs
pnpm lint:fix           # auto-fix ESLint violations
pnpm format:check       # Prettier check (no writes)
pnpm style:check        # lint + format:check combined (what CI runs)
pnpm type-check         # tsc --noEmit
```

Run a single test file:
```bash
pnpm vitest run tests/services/parser.test.ts
```

Dry-run the compiled CLI without moving files:
```bash
pnpm rename:dry-run     # movies + TV
pnpm music:dry-run      # music
```

## Architecture

The project is a CLI tool that organizes media files into Plex-compliant directory structures by parsing filenames and enriching them with TMDb metadata.

**Strict layered architecture — dependencies only flow downward:**

```
agents (CLI entry points)
  └── services (pure business logic: parser, formatter)
  └── repository (side-effectful I/O: fs, tmdb)
        └── config (env, logger)
              └── types (shared interfaces)
```

`src/agents/` hosts three `cli-*.ts` files, each with a `*Renamer` class and a `main()`. They orchestrate the full pipeline: scan → stage → parse → TMDb lookup → path construction → move → cleanup.

`src/services/parser.ts` is the most complex module (524 lines). It classifies filenames as `movie | tv_show | tv_date` and extracts `MediaInfo` fields (title, year, season, episode, episode_title, date_str). Most edge-case logic lives here.

`src/services/formatter.ts` converts a `MediaInfo` + TMDb result into a Plex path string. Three functions cover the three content types: `constructMoviePath`, `constructTvShowPath`, `constructTvShowDatePath`.

`src/repository/fs.ts` is the only code that mutates the filesystem. It handles staging (move to `processing/<session-id>/`), atomic moves (with copy+delete fallback for cross-device), sidecar file handling (`.srt`, `.nfo`, etc.), and empty directory pruning.

`src/repository/tmdb.ts` wraps the TMDb REST API with a 250 ms rate limiter, 3× retry, and in-memory cache. It exposes typed helpers: `findBestMovieMatch`, `findBestTvMatch`, `getEpisodeInfo`, `getEpisodeByAirDate`.

`src/config/env.ts` is the most-depended-on module. It resolves all directory paths (queue, processing, completed, failed, backups) relative to `../media` from the repo root (not CWD), and exports all regex patterns used by the parser.

## Key Design Decisions

**Staging prevents double-processing.** Files are moved to `processing/<session-id>/` before parsing. If a run is interrupted, the session directory is left in place so the operator can inspect it. The agents clean up their own session dir on graceful shutdown only.

**Failed vs. Backup are different quarantines.** `failed/` = TMDb returned no match (recoverable by re-running with different flags). `backups/` = filesystem error during move (potentially corrupt mid-flight — inspect before retrying).

**TMDb IDs are embedded in folder names.** Movie paths use `{tmdb-XXXXX}` and TV paths use `{tvdb-XXXXX}` suffixes. This is the Plex standard for unambiguous library matching and must be preserved exactly.

**ESM vs. CJS complexity.** The package root sets `"type": "module"` but TypeScript compiles to CommonJS (`"module": "CommonJS"` in tsconfig). Vitest injects `__dirname`/`__filename` per module. The post-build script (`scripts/write-dist-pkg.cjs`) writes a `dist/package.json` that forces CommonJS for the compiled output so the CLI bins work.

## Testing Notes

Tests mirror the source tree under `tests/`. Risk priority for coverage (highest to lowest): `fs.ts → parser.ts → formatter.ts → tmdb.ts → env.ts`. Agent-level logic is integration-only (too I/O-heavy for unit tests).

`tests/config/env.test.ts` stubs `dotenv` to remain hermetic — do not let env tests read actual `.env` files.

The `--no-recursive` CLI flag limits scanning to the top-level source directory. The default is recursive. Tests that exercise scanning need to account for this.

## Environment

Requires a `.env` file (see `.env.example`). Minimum: `TMDB_API_KEY`. Node ≥ 24, pnpm ≥ 9. The pinned version is in `.nvmrc` (v25.2.1); run `pnpm node:use` to switch.
