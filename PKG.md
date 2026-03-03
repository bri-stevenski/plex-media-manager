# Standalone Executables (pkg)

Build self-contained, pre-compiled executables for macOS, Windows, and Linux—no Node.js required.

## Quick Start

### 1. Build All Executables

```bash
node scripts/build-executables.js
```

This creates compressed binaries in `bin/` for all platforms:
- `bin/plex-rename-media/` — Media renaming tool
- `bin/plex-rename-music/` — Music renaming tool (when ready)

### 2. Run an Executable

**macOS/Linux:**
```bash
./bin/plex-rename-media/plex-rename-media --help
```

**Windows:**
```bash
.\bin\plex-rename-media\plex-rename-media.exe --help
```

### 3. Create a Dry-Run

```bash
./bin/plex-rename-media/plex-rename-media --dry-run --log-level DEBUG
```

## Building Individual Tools

### Media Renamer Only
```bash
npm run rename:pkg
```
Output: `bin/media/` (all platforms)

### Music Renamer Only
```bash
npm run music:pkg
```
Output: `bin/music/` (all platforms)

### All Tools
```bash
npm run pkg:all
```

## Architecture

Each executable is built for:
- **macOS (Intel)** — `node25-macos-x64`
- **macOS (Apple Silicon)** — `node25-macos-arm64`
- **Windows (x64)** — `node25-windows-x64`
- **Linux (x64)** — `node25-linux-x64`

Binaries are compressed with **Brotli** compression for smaller file sizes.

## What Users Get

✅ **No Node.js installation required** — Just download and run  
✅ **Standalone executables** — Works on any matching machine  
✅ **Compressed** — Smaller download sizes  
✅ **All OS support** — macOS, Windows, Linux  

Example executables:
```
plex-rename-media        (macOS/Linux)
plex-rename-media.exe    (Windows)
plex-rename-music        (macOS/Linux)
plex-rename-music.exe    (Windows)
```

## Distribution

1. Build executables: `node scripts/build-executables.js`
2. Upload `bin/` folder to GitHub Releases
3. Users download the version for their OS and architecture
4. Users make executable: `chmod +x plex-rename-media` (macOS/Linux)
5. Users run directly without Node.js

## Advanced Usage

### Customize Build Targets

Edit `package.json` in the `pkg` section to change which platforms are supported:

```json
"pkg": {
  "targets": [
    "node25-macos-x64",
    "node25-windows-x64"
  ]
}
```

Available targets: `node25-{macos,windows,linux}-{x64,arm64}`

### Change Output Paths

Executables are built to `bin/plex-{rename-media,rename-music}/` by default.

The build script can be customized in [scripts/build-executables.js](scripts/build-executables.js).

## Troubleshooting

### "pkg not found"
```bash
npm install --save-dev pkg
npm run pkg:all
```

### Large file sizes
Binaries are compressed with Brotli. If still large, ensure `dist/` only contains necessary files.

### Build fails on macOS
Install Xcode Command Line Tools:
```bash
xcode-select --install
```

### Build fails on Linux
Ensure build dependencies are installed:
```bash
sudo apt-get install python3 make g++
```

## Size Reference

Typical executable sizes (compressed):
- Media Renamer: ~35-45 MB (depending on platform)
- Music Renamer: ~35-45 MB (depending on platform)

Compression saves ~30-40% vs. uncompressed.
