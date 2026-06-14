#!/usr/bin/env node
/**
 * plex-check — Scan the TV library for missing episodes and report gaps.
 *
 * Usage:
 *   plex-check [options]
 *   plex-check --notify         # also push results to Discord/Pushover
 *   plex-check --show "Breaking Bad"  # check a single show
 */

import { program } from 'commander';
import path from 'path';
import { setupLogging } from '../config/logger.js';
import { MEDIA_BASE_DIR, COMPLETED_FOLDER, DEFAULT_LOG_LEVEL, CONTENT_TYPE_TV } from '../config/env.js';
import { TMDbClient } from '../repository/tmdb.js';
import { scanLibraryForMissingEpisodes, findMissingEpisodes } from '../services/missing-episodes.js';
import { notifyMissingEpisodes, isNotifierConfigured } from '../repository/notifier.js';

program
  .name('plex-check')
  .description('Detect missing episodes in your TV library')
  .option('--library-root <path>', 'Root of the media library', MEDIA_BASE_DIR)
  .option('--output-subfolder <name>', 'Completed folder name inside library root', COMPLETED_FOLDER)
  .option('--show <title>', 'Check only a specific show directory (partial match)')
  .option('--notify', 'Send results to configured notification channels', false)
  .option('--all', 'Include shows that have no gaps (verbose)', false)
  .option('--log-level <level>', 'Log level', DEFAULT_LOG_LEVEL)
  .action(async (options) => {
    const logger = setupLogging(options.logLevel.toUpperCase());
    const tvDir = path.join(path.resolve(options.libraryRoot), options.outputSubfolder, CONTENT_TYPE_TV);
    const tmdb = new TMDbClient();

    logger.info('Scanning TV library for missing episodes', { tvDir });

    const reports = await scanLibraryForMissingEpisodes(tvDir, tmdb, !options.all);

    if (reports.length === 0) {
      console.log('\n✅ No gaps found — library is complete.\n');
      return;
    }

    // Pretty-print results
    console.log();
    for (const report of reports) {
      if (report.missing.length === 0) {
        console.log(`✅ ${report.showTitle} — complete (${report.totalAired} aired)`);
        continue;
      }
      console.log(`❌ ${report.showTitle} — ${report.missing.length}/${report.totalAired} missing`);
      for (const ep of report.missing) {
        const s = String(ep.season).padStart(2, '0');
        const e = String(ep.episode).padStart(2, '0');
        console.log(`     S${s}E${e}  ${ep.airDate}  ${ep.episodeTitle}`);
      }
      console.log();
    }

    const totalShows = reports.filter((r) => r.missing.length > 0).length;
    const totalEps = reports.reduce((n, r) => n + r.missing.length, 0);
    console.log(`Summary: ${totalEps} missing episode(s) across ${totalShows} show(s)\n`);

    if (options.notify) {
      if (!isNotifierConfigured()) {
        logger.warning('--notify passed but no notification channels configured (DISCORD_WEBHOOK_URL or PUSHOVER_TOKEN/PUSHOVER_USER)');
      } else {
        await notifyMissingEpisodes(reports);
        logger.info('Gap report sent to notification channels');
      }
    }
  });

program.parse(process.argv);
