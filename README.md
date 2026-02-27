# Plex Media Manager

CLI tool for TMDb-driven media renaming and Plex-friendly organization.

## What It Does

- Parses movie and TV filenames
- Looks up canonical metadata in TMDb
- Renames and moves files into Plex-friendly paths
- Skips known supplemental content (`Featurettes`, `Extras`, trailers, etc.)

## Directory Model

Input defaults to:

- `<library-root>/queue`

Files are staged in:

- `<library-root>/processing/<run-id>/...`

Successful output defaults to:

- `<library-root>/completed/Movies/...`
- `<library-root>/completed/TV Shows/...`

Failures are moved to:

- `<library-root>/failed/...` (no TMDb match / invalid metadata)
- `<library-root>/backups/...` (move errors; safe quarantine)

Default `library-root` is the sibling `media` folder next to the repo
(for example `../media` from the repo root), resolved from the tool location
rather than your current shell working directory.

## Setup

Run full setup (version switch, clean install, style fixes, type-check, build):

```bash
npm run setup
```

Preview setup steps and run environment checks first:

```bash
npm run setup:check
```

Or run the steps manually:

1. Use the pinned Node/NPM versions from `.nvmrc`:

```bash
npm run node:use
```

1. Install dependencies:

```bash
npm install
```

1. Create `.env` with your TMDb API key:

```env
TMDB_API_KEY=your_api_key_here
```

1. Build the CLI:

```bash
npm run rename:build
```

## Usage

Run with defaults (`../media/queue` -> `../media/completed`):

```bash
npm run rename:run
```

Dry-run:

```bash
npm run rename:dry-run
```

Custom source:

Windows:

```bash
npm run rename:run -- "P:\\media\\queue"
```

macOS/Linux:

```bash
npm run rename:run -- "/media/queue"
```

Custom output subfolder:

Windows:

```bash
npm run rename:run -- --output-subfolder rename-complete "P:\\media\\queue"
```

macOS/Linux:

```bash
npm run rename:run -- --output-subfolder rename-complete "/media/queue"
```

## Development

- `npm run rename:build` compiles the renamer CLI to `dist/`
- `npm run logs:pretty` reads logs directly via `scripts/pretty-log.js` (no build step)
- `npm run logs:failures` shows only failure-causing entries from a run
- `npm run style:check` runs lint + format checks
- `npm run type-check` runs TypeScript checks
