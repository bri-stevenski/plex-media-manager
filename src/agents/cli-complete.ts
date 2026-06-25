#!/usr/bin/env node

/**
 * qBittorrent post-processing hook.
 *
 * Wire up in qBittorrent → Options → Downloads → "Run external program on torrent completion":
 *   node "C:\path\to\dist\agents\cli-complete.js" "%F" --category "%L" --library-root "P:\"
 *
 * %F = content path  (the downloaded file or top-level folder)
 * %L = category name (set to "movies" or "tv" in qBittorrent category settings)
 *
 * Classification order:
 *   1. --category flag ("movies" / "tv" / "television" / "shows")
 *   2. SxxExx or NxNN pattern in filename → TV
 *   3. Release-style season segment (.S04.) anywhere in path → TV
 *   4. Fallback → Movies
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { DEFAULT_LOG_LEVEL, MEDIA_BASE_DIR, setupLogging, getLogger } from '../config';

const logger = getLogger();

function classifyContent(contentPath: string, category: string): 'movies' | 'tv' {
  const cat = category.toLowerCase().trim();
  if (cat === 'movies' || cat === 'movie') return 'movies';
  if (cat === 'tv' || cat === 'television' || cat === 'shows' || cat === 'tvshows') return 'tv';

  const name = path.basename(contentPath);
  const segments = contentPath.split(/[/\\]/);

  if (/[Ss]\d{1,2}[Ee]\d{1,2}/.test(name) || /\b\d{1,2}[Xx]\d{1,2}\b/.test(name)) return 'tv';

  for (const seg of segments) {
    if (/\.[Ss]\d{1,2}\./.test(seg)) return 'tv';
  }

  return 'movies';
}

async function main() {
  const program = new Command();

  program
    .name('plex-complete')
    .description('qBittorrent post-processing hook — classifies and organizes a completed torrent')
    .argument('<content_path>', 'Path to completed torrent content (%F in qBittorrent)')
    .option('--category <name>', 'qBittorrent category (%L in qBittorrent)', '')
    .option('--dry-run', 'Preview changes without making modifications')
    .option(
      '--library-root <path>',
      'Root media folder containing destination subfolders',
      MEDIA_BASE_DIR,
    )
    .option('--movies-subfolder <name>', 'Destination subfolder for movies', 'Movies')
    .option('--tv-subfolder <name>', 'Destination subfolder for TV shows', 'TV Shows')
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action((contentPath: string, options) => {
      setupLogging(options.logLevel, './.logs', true);

      const resolved = path.resolve(contentPath);
      if (!fs.existsSync(resolved)) {
        logger.error(`Content path does not exist: ${resolved}`);
        process.exit(1);
      }

      const type = classifyContent(resolved, options.category);
      logger.info(`Classified "${path.basename(resolved)}" as: ${type}`, {
        category: options.category || '(none)',
        content_path: resolved,
      });

      // Single-file torrent: scan its parent dir without recursing into sibling folders.
      // Folder torrent: scan the folder itself (recursive to handle subdirs).
      const isFile = fs.statSync(resolved).isFile();
      const sourceDir = isFile ? path.dirname(resolved) : resolved;
      const outputSubfolder = type === 'movies' ? options.moviesSubfolder : options.tvSubfolder;
      const agentScript = path.resolve(
        __dirname,
        type === 'movies' ? 'cli-movies.js' : 'cli-tv.js',
      );

      const args = [
        agentScript,
        sourceDir,
        '--library-root',
        options.libraryRoot,
        '--output-subfolder',
        outputSubfolder,
        '--log-level',
        options.logLevel,
      ];
      if (isFile) args.push('--no-recursive');
      if (options.dryRun) args.push('--dry-run');

      logger.info(
        `Delegating to ${type === 'movies' ? 'cli-movies' : 'cli-tv'} — source: ${sourceDir}`,
      );

      const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
      process.exit(result.status ?? 0);
    });

  program.parse(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
