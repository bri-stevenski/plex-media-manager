#!/usr/bin/env node
/**
 * plex-watchlist — Compare your Trakt watchlist against the local library.
 *
 * Usage:
 *   plex-watchlist                      # compare authenticated user's list
 *   plex-watchlist --user someusername  # compare a public list
 *   plex-watchlist --wanted-only        # only print items not yet owned
 *   plex-watchlist --notify             # push "wanted" list to Discord/Pushover
 */

import { program } from 'commander';
import path from 'path';
import { setupLogging } from '../config/logger.js';
import { MEDIA_BASE_DIR, COMPLETED_FOLDER, DEFAULT_LOG_LEVEL } from '../config/env.js';
import { syncWatchlist } from '../services/watchlist-sync.js';
import { notify, isNotifierConfigured } from '../repository/notifier.js';
import { isTraktConfigured } from '../repository/trakt.js';

program
  .name('plex-watchlist')
  .description('Compare Trakt watchlist against your library')
  .option('--library-root <path>', 'Root of the media library', MEDIA_BASE_DIR)
  .option('--output-subfolder <name>', 'Completed folder name', COMPLETED_FOLDER)
  .option('--user <username>', 'Trakt username for public watchlist (omit to use authenticated user)')
  .option('--wanted-only', 'Only show items not yet in the library', false)
  .option('--notify', 'Send wanted list to configured notification channels', false)
  .option('--log-level <level>', 'Log level', DEFAULT_LOG_LEVEL)
  .action(async (options) => {
    const logger = setupLogging(options.logLevel.toUpperCase());

    if (!isTraktConfigured()) {
      console.error(
        '\n❌ Trakt not configured.\n   Set TRAKT_CLIENT_ID in your .env file.\n' +
          '   For private watchlists also set TRAKT_ACCESS_TOKEN.\n',
      );
      process.exit(1);
    }

    const completedDir = path.join(path.resolve(options.libraryRoot), options.outputSubfolder);
    const result = await syncWatchlist(completedDir, options.user);

    if (result.total === 0) {
      console.log('\n(Watchlist is empty)\n');
      return;
    }

    console.log(`\nTrakt watchlist: ${result.total} items\n`);

    if (!options.wantedOnly && result.alreadyOwned.length > 0) {
      console.log(`✅ Already in library (${result.alreadyOwned.length})`);
      for (const item of result.alreadyOwned) {
        const year = item.year ? ` (${item.year})` : '';
        const type = item.type === 'movie' ? '🎬' : '📺';
        console.log(`   ${type} ${item.title}${year}`);
      }
      console.log();
    }

    if (result.wanted.length === 0) {
      console.log('🎉 You have everything on your watchlist!\n');
    } else {
      console.log(`🔍 Wanted — not yet in library (${result.wanted.length})`);
      for (const item of result.wanted) {
        const year = item.year ? ` (${item.year})` : '';
        const type = item.type === 'movie' ? '🎬' : '📺';
        const tmdb = item.tmdbId ? `  [tmdb:${item.tmdbId}]` : '';
        console.log(`   ${type} ${item.title}${year}${tmdb}`);
      }
      console.log();
    }

    if (options.notify && result.wanted.length > 0) {
      if (!isNotifierConfigured()) {
        logger.warning('--notify passed but no notification channels configured');
      } else {
        const lines = result.wanted
          .slice(0, 20)
          .map((i) => {
            const year = i.year ? ` (${i.year})` : '';
            const icon = i.type === 'movie' ? '🎬' : '📺';
            return `${icon} **${i.title}**${year}`;
          })
          .join('\n');
        const overflow = result.wanted.length > 20 ? `\n…and ${result.wanted.length - 20} more` : '';
        await notify(
          `Watchlist: ${result.wanted.length} item(s) still wanted`,
          lines + overflow,
        );
        logger.info('Watchlist report sent to notification channels');
      }
    }
  });

program.parse(process.argv);
