# AGENTS.md - Plex Media Manager

> Instructions and context for Harness agents working on the Plex Media Manager project.

## Project Overview

Plex Media Manager is a TypeScript-based CLI tool designed to automate the organization of media libraries for Plex. It handles filename parsing, metadata retrieval from TMDb, and safe file operations to move media into a Plex-friendly directory structure.

## Core Technologies

- **Language:** TypeScript (Node.js >= 24)
- **Metadata Source:** The Movie Database (TMDb) API
- **CLI Framework:** Commander.js
- **Network:** Axios
- **Logging:** Winston
- **Engineering Standards:** Harness Engineering

## Architecture (Advanced Level)

The project follows a strict layered architecture and uses the Advanced Harness adoption level, which includes persona-based agent interactions and automated state management.

### Personas

The following personas are configured for this project:

- **Architecture Enforcer**: Validates layer boundaries and dependency rules.
- **Code Reviewer**: Performs deep-dive reviews and addresses findings.
- **Planner**: Breaks down complex requirements into executable phase plans.
- **Task Executor**: Implements tasks with TDD and verification.
- **Verifier**: Audits implementation against specifications.

### State & Learnings

- **State**: Persistent project state is stored in `.harness/`.
- **Learnings**: Institutional knowledge is captured in `.harness/learnings/`.

### Layers

1.  **Agents (`src/agents/`)**: CLI entry points — three organizers:
    - `cli-movies.ts` — TMDb-driven movie organizer
    - `cli-tv.ts` — TMDb-driven TV show organizer
    - `cli-music.ts` — Music organizer (MusicBrainz, stub)
    - Allowed imports: `services`, `repository`, `config`, `types`.
2.  **Services (`src/services/`)**: Business logic (parsing, formatting).
    - Allowed imports: `repository`, `config`, `types`.
3.  **Repository (`src/repository/`)**: Data access (TMDb API, Filesystem).
    - Allowed imports: `config`, `types`.
4.  **Config (`src/config/`)**: Environment and logging configuration.
    - Allowed imports: `types`.
5.  **Types (`src/types/`)**: Shared interfaces and type definitions.
    - No internal layer imports allowed.

## Key Conventions

- **Safe Filesystem Operations**: Always use `safeMove` and `ensureDirectoryExists` from `src/repository/fs.ts`.
- **Sidecar Files**: Media files often have sidecars (.srt, .nfo). Ensure they are handled during staging and organization.
- **Staging**: Files MUST be moved to `processing/` before lookup and final organization to ensure atomicity.
- **Logging**: Use the centralized logger. Avoid `console.log` in production code.
- **TMDb Matching**: Use the scoring logic in `src/repository/tmdb.ts` to ensure high-confidence matches.

## Constraints & Forbidden Patterns

- **No direct FS calls**: Avoid using `fs` or `fs/promises` directly in `services` or `agents`. Use the `repository/fs` wrapper. _(Note: `cli-movies.ts` and `cli-tv.ts` currently violate this — direct `fs` import will be removed when both agents are refactored to delegate to `MediaProcessor`. See `docs/changes/phase-1-ai-core/plans/2026-05-12-unified-media-processor-plan.md`.)_
- **No global state**: Keep renamer logic encapsulated in classes (e.g., `MoviesRenamer`).
- **Circular Dependencies**: Strictly forbidden across and within layers.

## Commands

- `npm run setup`: Full setup and build.
- `npm run rename:run`: Run the unified media renamer (requires `src/agents/cli-media.ts` — planned).
- `npm run start:movies`: Run the movies organizer (`cli-movies.ts`).
- `npm run start:tv`: Run the TV show organizer (`cli-tv.ts`).
- `npm run music:run`: Run the music organizer (`cli-music.ts`).
- `npm run rename:dry-run`: Preview rename changes without moving files.
- `npm run music:dry-run`: Preview music organize changes without moving files.
- `npm run build`: Compile TypeScript.
- `npm run build:executables`: Build standalone caxa executables for movies and music organizers.
- `npm run validate`: Run Harness validation.
- `harness check-deps`: Verify layer boundaries.
