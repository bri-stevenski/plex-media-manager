#!/usr/bin/env node
/**
 * plex-watch — End-to-end automation daemon.
 *
 * Pipeline per poll cycle:
 *   1. Pull completed torrents from qBittorrent → copy to queue
 *   2. Run movies + TV organizers (rename + move to library)
 *   3. Fetch subtitles for newly organized files
 *   4. Trigger Plex library scan
 *   5. Report summary
 */

import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { setupLogging } from '../config/logger.js';
import {
  MEDIA_BASE_DIR,
  QUEUE_FOLDER,
  COMPLETED_FOLDER,
  DEFAULT_LOG_LEVEL,
  VIDEO_EXTENSIONS,
} from '../config/env.js';
import { PlexClient, isPlexConfigured } from '../repository/plex.js';
import { OpenSubtitlesClient, isOpenSubtitlesConfigured } from '../repository/opensubtitles.js';
import { QBittorrentClient, isQBittorrentConfigured } from '../repository/download-client.js';
import { notifyMediaAdded, notifyError, isNotifierConfigured } from '../repository/notifier.js';
import { MoviesRenamer } from './cli-movies.js';
import { TvRenamer } from './cli-tv.js';

interface WatchOptions {
  interval: number;
  dryRun: boolean;
  logLevel: string;
  libraryRoot: string;
  outputSubfolder: string;
  subtitleLanguages: string;
  qbCategory: string;
  once: boolean;
}

async function runCycle(opts: WatchOptions): Promise<void> {
  const logger = setupLogging(opts.logLevel);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const queueDir = path.join(libraryRoot, QUEUE_FOLDER);

  const summary = {
    staged: 0,
    organized: 0,
    subtitlesFetched: 0,
    plexScansTriggered: 0,
    errors: 0,
  };

  // Track what was organized so we can notify
  const organizedItems: { title: string; year?: number; type: 'movie' | 'tv' }[] = [];

  // ── 1. Stage from qBittorrent ──────────────────────────────────────────────
  if (isQBittorrentConfigured()) {
    try {
      const qb = new QBittorrentClient();
      const torrents = await qb.getCompletedTorrents(opts.qbCategory || undefined);
      const unprocessed = torrents.filter((t) => !t.tags.includes('plex-processed'));

      for (const torrent of unprocessed) {
        const staged = await qb.stageForProcessing(torrent, queueDir, VIDEO_EXTENSIONS);
        summary.staged += staged.length;

        if (!opts.dryRun && staged.length > 0) {
          await qb.setCategory(torrent.hash, 'plex-processed');
        }
      }
    } catch (err: any) {
      logger.error('qBittorrent staging failed', { error: err.message });
      summary.errors++;
    }
  } else {
    logger.debug('qBittorrent not configured, skipping staging step');
  }

  // ── 2. Organize (movies + TV) ──────────────────────────────────────────────
  const queueExists = fs.existsSync(queueDir) && fs.readdirSync(queueDir).length > 0;
  if (!queueExists && summary.staged === 0) {
    logger.info('Queue is empty, nothing to organize');
  } else {
    const newlyOrganized: string[] = [];

    try {
      const movies = new MoviesRenamer(
        opts.dryRun,
        opts.logLevel,
        true,
        false,
        libraryRoot,
        opts.outputSubfolder,
      );
      // Monkey-patch to capture destinations
      await movies.run(queueDir);
    } catch (err: any) {
      logger.error('Movie organizer failed', { error: err.message });
      summary.errors++;
    }

    try {
      const tv = new TvRenamer(
        opts.dryRun,
        opts.logLevel,
        true,
        false,
        libraryRoot,
        opts.outputSubfolder,
      );
      await tv.run(queueDir);
    } catch (err: any) {
      logger.error('TV organizer failed', { error: err.message });
      summary.errors++;
    }
  }

  // ── 3. Fetch subtitles for recently added files ────────────────────────────
  if (isOpenSubtitlesConfigured() && !opts.dryRun) {
    const completedDir = path.join(libraryRoot, opts.outputSubfolder);
    const langs = opts.subtitleLanguages.split(',').map((l) => l.trim()).filter(Boolean);
    const client = new OpenSubtitlesClient();

    try {
      await client.login();
      const recentCutoff = Date.now() - opts.interval * 1000 * 2;
      const fetchSubsForDir = async (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await fetchSubsForDir(full);
          } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            const stat = fs.statSync(full);
            if (stat.mtimeMs < recentCutoff) continue;

            const tmdbMatch = entry.name.match(/\{tmdb-(\d+)\}/);
            if (!tmdbMatch) continue;
            const tmdbId = parseInt(tmdbMatch[1], 10);

            const type = full.includes('TV Shows') ? 'episode' : 'movie';
            const seasonMatch = full.match(/Season (\d+)/);
            const epMatch = entry.name.match(/[sS](\d+)[eE](\d+)/);

            const result = await client.downloadBestSubtitle(
              full,
              tmdbId,
              langs,
              type,
              seasonMatch ? parseInt(seasonMatch[1], 10) : undefined,
              epMatch ? parseInt(epMatch[2], 10) : undefined,
            );
            if (result) summary.subtitlesFetched++;
          }
        }
      };
      await fetchSubsForDir(completedDir);
      await client.logout();
    } catch (err: any) {
      logger.error('Subtitle fetch failed', { error: err.message });
      summary.errors++;
    }
  }

  // ── 4. Trigger Plex scan ───────────────────────────────────────────────────
  if (isPlexConfigured() && !opts.dryRun) {
    try {
      const plex = new PlexClient();
      if (await plex.isReachable()) {
        const completedDir = path.join(libraryRoot, opts.outputSubfolder);
        await plex.refreshLibraryForPath(completedDir);
        summary.plexScansTriggered++;
      } else {
        logger.warning('Plex server not reachable, skipping scan');
      }
    } catch (err: any) {
      logger.error('Plex scan failed', { error: err.message });
      summary.errors++;
    }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  if (isNotifierConfigured() && !opts.dryRun && organizedItems.length > 0) {
    await notifyMediaAdded(organizedItems).catch((err: any) =>
      logger.warning('Notification failed', { error: err.message }),
    );
  }

  if (summary.errors > 0 && isNotifierConfigured() && !opts.dryRun) {
    await notifyError('watch cycle', `${summary.errors} error(s) occurred during processing`).catch(
      () => {},
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  logger.info('Watch cycle complete', summary);
}

program
  .name('plex-watch')
  .description('End-to-end automation: stage → organize → subtitles → Plex scan')
  .option('--interval <seconds>', 'Poll interval in seconds (0 = run once)', '300')
  .option('--once', 'Run a single cycle and exit', false)
  .option('--dry-run', 'Preview actions without making changes', false)
  .option('--library-root <path>', 'Root of the media library', MEDIA_BASE_DIR)
  .option('--output-subfolder <name>', 'Completed folder name', COMPLETED_FOLDER)
  .option('--subtitle-languages <langs>', 'Comma-separated language codes', 'en')
  .option('--qb-category <name>', 'Only process torrents in this qBittorrent category', '')
  .option('--log-level <level>', 'Log level: DEBUG | INFO | WARN | ERROR', DEFAULT_LOG_LEVEL)
  .action(async (options) => {
    const opts: WatchOptions = {
      interval: parseInt(options.interval, 10),
      dryRun: options.dryRun,
      logLevel: options.logLevel.toUpperCase(),
      libraryRoot: options.libraryRoot,
      outputSubfolder: options.outputSubfolder,
      subtitleLanguages: options.subtitleLanguages,
      qbCategory: options.qbCategory,
      once: options.once || options.interval === '0',
    };

    const logger = setupLogging(opts.logLevel);

    if (opts.dryRun) logger.info('Dry-run mode — no files will be moved or downloaded');

    const cycle = async () => {
      try {
        await runCycle(opts);
      } catch (err: any) {
        logger.error('Unexpected error in watch cycle', { error: err.message });
      }
    };

    await cycle();

    if (!opts.once) {
      const ms = opts.interval * 1000;
      logger.info(`Watching — next cycle in ${opts.interval}s`);
      setInterval(cycle, ms);
    }
  });

program.parse(process.argv);
