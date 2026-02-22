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

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with your TMDb API key:

```env
TMDB_API_KEY=your_api_key_here
```

3. Build the CLI:

```bash
npm run build:tools
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

- `npm run build:tools` compiles the CLI to `dist/`
- `npm run validate` runs type-check, lint, and format checks
