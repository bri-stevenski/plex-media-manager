# Plex Media Manager - Project Context

This project is a TypeScript-based media organizer for Plex. It automates the renaming and organization of movies, TV shows, and music by parsing filenames and fetching canonical metadata from The Movie Database (TMDb).

## Architecture & Layers

The project follows a strict layered architecture enforced by Harness:

1.  **Agents (`src/agents/`)**: CLI entry points (e.g., `cli-movies.ts`, `cli-tv.ts`). They orchestrate the high-level workflow.
2.  **Services (`src/services/`)**: Core business logic.
    *   `parser.ts`: Extract metadata (title, year, season, episode) from noisy filenames.
    *   `formatter.ts`: Construct Plex-compliant directory and file paths.
3.  **Repository (`src/repository/`)**: Data access and external integrations.
    *   `tmdb.ts`: TMDb API client with rate limiting, retries, and result scoring.
    *   `fs.ts`: Safe filesystem operations, including sidecar file handling (SRT, NFO) and directory pruning.
4.  **Config (`src/config/`)**: Environment variables (`env.ts`) and logging setup (`logger.ts`).
5.  **Types (`src/types/`)**: Shared TypeScript interfaces (e.g., `MediaInfo`).

## Core Workflows

### Media Renaming Pipeline
1.  **Scan**: Identify media files in the source directory (defaults to `queue/`).
2.  **Stage**: Move files to a unique session folder in `processing/` to prevent collisions.
3.  **Parse**: Extract title and year/season/episode from the filename.
4.  **Lookup**: Query TMDb for the canonical title and ID.
5.  **Organize**: Rename and move the file to the `completed/` directory in a Plex-friendly structure:
    *   `Movies/Title (Year) {tmdb-id}/Title (Year) {tmdb-id}.ext`
    *   `TV Shows/Show (Year) {tmdb-id}/Season XX/Show (Year) - sXXeYY - Title.ext`
6.  **Cleanup**: Move failures to `failed/` or `backups/` and prune empty source directories.

## Building and Running

### Prerequisites
*   Node.js >= 24.0.0
*   TMDb API Key (set as `TMDB_API_KEY` in `.env`)

### Key Commands
*   `npm run setup`: Full setup (install, check, build).
*   `npm run rename:build`: Compile the CLI tools.
*   `npm run rename:run`: Run the renamer with default settings.
*   `npm run rename:dry-run`: Preview changes without moving files.
*   `npm run style:check`: Run ESLint and Prettier checks.
*   `npm run type-check`: Run TypeScript compiler checks.
*   `npm run validate`: Run Harness validation checks.

## Development Conventions

*   **Strict Layering**: Do not violate the import boundaries defined in `harness.config.json`.
*   **Logging**: Use the centralized logger from `src/config/logger.ts`. Avoid `console.log`.
*   **Error Handling**: Use custom error classes (e.g., `TMDbError`) and ensure files are safely moved to `backups/` or `failed/` if processing fails.
*   **Safe FS Operations**: Always use `safeMove` and `ensureDirectoryExists` from `src/repository/fs.ts` to prevent data loss.
*   **Sidecar Files**: Ensure subtitle (`.srt`), metadata (`.nfo`), and other sidecar files are moved along with the main media file.
