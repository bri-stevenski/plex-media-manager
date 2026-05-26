# Architecture

Plex Media Manager is a CLI toolset that organizes local media files into Plex-friendly directory structures using TMDb metadata.

## CLI Entry Points

| Command | Source | Purpose |
|---------|--------|---------|
| `plex-movies` | [cli-movies.ts](../src/agents/cli-movies.ts) | Organizes movie files using TMDb movie search |
| `plex-tv` | [cli-tv.ts](../src/agents/cli-tv.ts) | Organizes TV episode files using TMDb TV search |
| `plex-music` | [cli-music.ts](../src/agents/cli-music.ts) | Organizes music files using MusicBrainz metadata |

## Layer Breakdown

### Config ([src/config/index.ts](../src/config/index.ts))

- [env.ts](../src/config/env.ts) — Environment variable bindings: media base dir, folder names, API keys, regex patterns, log settings
- [logger.ts](../src/config/logger.ts) — `PlexLogger` wrapper around Winston with file + console transports; `getLogger()` / `setupLogging()` singletons

### Types ([src/types/index.ts](../src/types/index.ts))

- [media.ts](../src/types/media.ts) — Core domain types: `MediaInfo` (parsed filename metadata) and `FileResult` status union

### Repository ([src/repository/index.ts](../src/repository/index.ts))

- [tmdb.ts](../src/repository/tmdb.ts) — `TMDbClient`: searches TMDb for movies and TV shows; `TMDbError` / `TMDbAPIError` for typed error handling
- [fs.ts](../src/repository/fs.ts) — File system operations: scan queue, move/copy media files through the processing pipeline

### Services ([src/services/index.ts](../src/services/index.ts))

- [parser.ts](../src/services/parser.ts) — Parses raw filenames into `MediaInfo`: extracts title, year, season/episode, air date
- [formatter.ts](../src/services/formatter.ts) — Formats `MediaInfo` into Plex-compliant directory and filename paths

## Scripts

- [setup.js](../scripts/setup.js) — Bootstraps `.env` from `.env.example` and validates required environment variables
- [clean.js](../scripts/clean.js) — Removes `dist/` and other generated build artifacts
- [build-executables.js](../scripts/build-executables.js) — Bundles CLI entry points into standalone executables via caxa
