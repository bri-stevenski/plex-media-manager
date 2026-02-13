# Plex Media Manager - TypeScript Version

This is a TypeScript implementation of the Python Plex media processing tools. It provides CLI tools for renaming and transcoding media files according to Plex conventions.

## Installation

### Prerequisites

- Node.js 16+ and npm
- FFmpeg and FFprobe installed on your system
- A valid TMDb API key (get one from https://www.themoviedb.org/settings/api)

### Setup

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

Create a `.env` file in the project root:

```env
TMDB_API_KEY=your_api_key_here
```

3. Build the TypeScript tools:

```bash
npm run build:tools
```

## Usage

### Media Renamer

Rename and organize media files according to Plex conventions:

```bash
npm run rename [source_dir] [options]
```

**Options:**
- `--dry-run`: Preview changes without making modifications
- `--use-episode-titles`: Use episode titles instead of S##E## numbers for TV shows
- `--log-level <level>`: Logging level (DEBUG, INFO, WARN, ERROR)

**Examples:**

```bash
# Process from default directory
npm run rename

# Process from custom directory
npm run rename /path/to/media

# Preview changes without making modifications
npm run rename --dry-run

# Enable debug logging
npm run rename --log-level DEBUG
```

### Media Transcoder

Transcode non-MP4 videos to MP4 format for Plex compatibility:

```bash
npm run transcode [source_dir] [options]
```

**Options:**
- `--dry-run`: Preview changes without making modifications
- `--log-level <level>`: Logging level (DEBUG, INFO, WARN, ERROR)
- `--workers <num>`: Number of worker processes for parallel transcoding

**Examples:**

```bash
# Process from default transcode directory
npm run transcode

# Process from custom directory
npm run transcode /path/to/media

# Use 8 parallel workers
npm run transcode --workers 8

# Preview changes
npm run transcode --dry-run
```

## Project Structure

```
src/
├── utils/
│   ├── constants.ts        # Configuration constants
│   ├── fileManager.ts      # File operations (scan, move, copy)
│   ├── formatter.ts        # Plex-compliant filename formatting
│   ├── logger.ts           # Structured logging with JSON output
│   ├── parser.ts           # Filename parsing and metadata extraction
│   ├── tmdbClient.ts       # TMDb API client
│   ├── transcoder.ts       # Video transcoding with FFmpeg
│   └── index.ts            # Central export file
├── renameMediaFiles.ts     # CLI tool for renaming files
├── transcodeMediaFiles.ts  # CLI tool for transcoding files
```

## Features

### Rename Tool

- **Filename Parsing**: Extracts metadata from filenames (title, year, season, episode)
- **TMDb Integration**: Looks up metadata from The Movie Database API
- **Plex Conventions**: Renames files and creates folder structures compatible with Plex
- **Smart Routing**: Routes MP4 files to upload folder, non-MP4 files to transcode folder

### Transcode Tool

- **Format Auto-detection**: Analyzes video files for compatibility
- **Parallel Transcoding**: Uses configurable number of workers for batch processing
- **Format Conversion**: Converts to MP4 (H.264 + AAC) for Apple TV compatibility
- **File Validation**: Validates transcoded output before moving

## Configuration

### Transcode Settings

Edit `src/utils/constants.ts` to modify transcoding parameters:

```typescript
export const TRANSCODE_SETTINGS = {
  video_codec: 'libx264',      // Video encoder
  audio_codec: 'aac',           // Audio encoder
  preset: 'medium',             // Encoding speed (ultrafast to veryslow)
  crf: 23,                       // Quality (0-51, lower is better)
  audio_bitrate: '128k',        // Audio bitrate
  max_audio_channels: 2,        // Maximum audio channels
};
```

### Folder Structure

The media processing system expects the following folder structure:

```
../media/
├── rename/
│   ├── Movies/
│   └── TV Shows/
├── transcode/
│   ├── Movies/
│   └── TV Shows/
├── upload/
│   ├── Movies/
│   └── TV Shows/
└── errors/
```

## Logging

Logs are written to `./.logs/` directory in JSON format for easy parsing and analysis.

- **plex-media-tool_*.log**: Main log files with structured JSON output

### Log Levels

- `DEBUG`: Detailed information for debugging
- `INFO`: General informational messages
- `WARN`: Warning messages
- `ERROR`: Error messages

## Migration from Python

This TypeScript version maintains feature parity with the original Python implementation while leveraging:

- **Better performance**: Parallel processing with native Node.js concurrency
- **Type safety**: Full TypeScript support for better IDE integration
- **Simpler deployment**: No Python environment setup required
- **Unified stack**: Works alongside the Next.js frontend

Key differences from Python version:

- Uses `axios` instead of `requests` for HTTP calls
- Uses `commander` instead of `argparse` for CLI parsing
- Uses `luxon` instead of Python's `datetime` for date handling
- Async/await instead of concurrent.futures

## Development

To work with the TypeScript source directly:

```bash
# Build TypeScript
npm run build:tools

# Run directly with ts-node (requires ts-node installation)
npx ts-node src/renameMediaFiles.ts --help

# Watch mode (requires tsc in watch mode)
tsc -w
```

## Troubleshooting

### FFmpeg/FFprobe not found

Ensure FFmpeg is installed and in your PATH:

```bash
# macOS (using Homebrew)
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg
```

### TMDb API Key errors

- Verify your API key is set in `.env`
- Check that your API key is valid at https://www.themoviedb.org/settings/api
- Ensure the API key has the correct permissions

### Permission errors on specific files

Some files may fail to move due to permissions. They'll be moved to the `errors` folder for review.

## Performance Notes

- **Transcoding**: Uses CPU-intensive encoding. Adjust `--workers` based on your system
- **File scanning**: Large media libraries may take time to scan
- **TMDb lookups**: API calls are cached per session to reduce requests

## License

This project is part of the plex-media-manager project.
