# Docker Setup Guide

This project is containerized to support both media (movies/TV) and music file organization.

## Prerequisites

- Docker installed and running (`docker --version`)
- Docker Compose v2 available (`docker compose version`)

## Quick Start

### 1. Create Environment File

Copy the example environment file and update with your configuration:

```bash
cp .env.example .env
```

Edit `.env` and add:
- `TMDB_API_KEY`: Your TMDb API key
- `MEDIA_LIBRARY_ROOT` (optional): Host path to your media library (defaults to `./media`)
- `MUSIC_LIBRARY_ROOT` (optional): Host path to your music library (defaults to `./music`)
- `LOG_LEVEL` (optional): Logging level (DEBUG, INFO, WARN, ERROR)

### 2. Run Media Renamer

Build and start the media renaming service:

```bash
docker compose up --build media-renamer
```

Or for a dry-run to preview changes:

```bash
docker compose run --rm media-renamer node dist/rename-media-files.js --dry-run --log-level DEBUG
```

### 3. Run Music Renamer (When Ready)

Once the music renamer is implemented, start it with:

```bash
docker compose up --build music-renamer
```

## Common Commands

### Interactive Mode

For interactive debugging:

```bash
docker compose run --rm media-renamer node dist/rename-media-files.js --log-level DEBUG
```

### View Logs

```bash
docker compose logs -f media-renamer
```

### Build Only

```bash
docker compose build media-renamer
```

### Dry Run

Test file organization without moving files:

```bash
docker compose run --rm media-renamer node dist/rename-media-files.js --dry-run
```

### Development Mode

For development with hot-reload, you can run locally with npm:

```bash
npm run rename:run
```

## Volume Mounts

The Compose configuration mounts:

- **Media Library**: `${MEDIA_LIBRARY_ROOT}:/media` - Video library
- **Music Library**: `${MUSIC_LIBRARY_ROOT}:/music` - Audio library
- **Logs**: `./.logs:/app/.logs` - Application logs

## Service Architecture

### Media Renamer
- **Image**: Built from `Dockerfile`
- **Purpose**: Organizes movies and TV shows using TMDb metadata
- **Input**: `./media/queue`
- **Output**: `./media/organized/`

### Music Renamer
- **Image**: Built from `Dockerfile.music`
- **Purpose**: Organizes music files using MusicBrainz metadata
- **Input**: `./music/queue`
- **Output**: `./music/organized/`
- **Status**: Available via `--profile music`

## Development

### Building Locally

```bash
npm install
npm run rename:build
npm run rename:run
```

### Testing Changes

Mount source code for live testing:

```bash
docker compose run \
  -v $(pwd)/src:/app/src \
  -v $(pwd)/dist:/app/dist \
  --rm media-renamer \
  sh
```

## Troubleshooting

### Permission Issues

If you encounter permission errors with volume mounts, ensure the media directories exist and have proper permissions:

```bash
mkdir -p ./media/queue ./media/organized
mkdir -p ./music/queue ./music/organized
chmod 755 ./media ./music
```

### API Key Issues

Make sure your `.env` file contains valid API keys:

```bash
grep TMDB_API_KEY .env
grep MUSICBRAINZ_API_KEY .env
```

### View Container Logs

```bash
docker compose logs media-renamer
docker compose logs music-renamer
```

### Stop All Containers

```bash
docker compose down
```
