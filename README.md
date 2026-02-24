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

Output defaults to:

- `<library-root>/organized/Movies/...`
- `<library-root>/organized/TV Shows/...`

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

2. Install dependencies:

```bash
npm install
```

3. Create `.env` with your TMDb API key:

```env
TMDB_API_KEY=your_api_key_here
```

4. Build the CLI:

```bash
npm run build:rename
```

## Usage

Run with defaults (`../media/queue` -> `../media/organized`):

```bash
npm run rename
```

Dry-run:

```bash
npm run rename:dry-run
```

Custom source:

Windows:

```bash
npm run rename -- "P:\\media\\queue"
```

macOS/Linux:

```bash
npm run rename -- "/media/queue"
```

Custom output subfolder:

Windows:

```bash
npm run rename -- --output-subfolder rename-complete "P:\\media\\queue"
```

macOS/Linux:

```bash
npm run rename -- --output-subfolder rename-complete "/media/queue"
```

## Development

- `npm run build:rename` compiles the renamer CLI to `dist/`
- `npm run logs:pretty` reads logs directly via `scripts/pretty-log.js` (no build step)
- `npm run logs:failures` shows only failure-causing entries from a run
- `npm run style:check` runs lint + format checks
- `npm run type-check` runs TypeScript checks
