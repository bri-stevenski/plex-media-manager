#!/usr/bin/env node

/**
 * Plex Media Renamer: Handles file parsing, TMDb lookup, and file organization.
 *
 * This script processes media files by:
 * - Parsing filenames to extract metadata
 * - Looking up TMDb metadata for movies and TV shows
 * - Renaming files according to Plex conventions
 * - Moving MP4 files directly to upload folder
 * - Moving non-MP4 files to transcode folder
 * - Handling errors gracefully
 */

import path from 'path';
import { Command } from 'commander';
import {
  CONTENT_TYPE_MOVIES,
  CONTENT_TYPE_TV,
  DEFAULT_LOG_LEVEL,
  ERROR_FOLDER,
  LOG_DIR,
  MEDIA_BASE_FOLDER,
  RENAME_FOLDER,
  TRANSCODE_FOLDER,
  UPLOAD_FOLDER,
} from './utils/constants';
import {
  createErrorDirectory,
  ensureDirectoryExists,
  safeMove,
  scanMediaFiles,
} from './utils/fileManager';
import { setupLogging, getLogger } from './utils/logger';
import { parseMediaFile } from './utils/parser';
import { constructMoviePath, constructTvShowPath } from './utils/formatter';
import { TMDbClient } from './utils/tmdbClient';

const logger = getLogger();

class MediaRenamer {
  private dryRun: boolean;
  private logLevel: string;
  private running = true;
  private tmdbClient: TMDbClient;
  private createdDirectories: Set<string>;
  private errorDir: string;
  private useEpisodeTitles: boolean;

  constructor(dryRun: boolean = false, logLevel: string = DEFAULT_LOG_LEVEL, useEpisodeTitles: boolean = false) {
    this.dryRun = dryRun;
    this.logLevel = logLevel;
    this.useEpisodeTitles = useEpisodeTitles;
    this.createdDirectories = new Set();
    this.errorDir = '';

    setupLogging(logLevel, LOG_DIR, true);

    try {
      this.tmdbClient = new TMDbClient();
    } catch (error) {
      logger.error(`Failed to initialize TMDb client: ${error}`);
      process.exit(1);
    }

    // Set up signal handlers
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());

    logger.info('Media Renamer initialized', { dry_run: dryRun });
  }

  private handleShutdown(): void {
    logger.info('Received shutdown signal, exiting gracefully...');
    this.running = false;
    process.exit(0);
  }

  async run(sourceDir?: string): Promise<void> {
    const queueDir = sourceDir
      ? path.resolve(sourceDir)
      : path.resolve(MEDIA_BASE_FOLDER, RENAME_FOLDER);

    logger.info(`Starting media renaming from: ${queueDir}`);

    this.setupDirectories();

    let totalFilesProcessed = 0;
    let totalFilesSuccessful = 0;
    let totalFilesFailed = 0;
    let mp4FilesMoved = 0;
    let nonMp4FilesMoved = 0;

    try {
      for (const contentType of [CONTENT_TYPE_MOVIES, CONTENT_TYPE_TV]) {
        if (!this.running) break;

        const contentQueueDir = path.join(queueDir, contentType);

        if (!require('fs').existsSync(contentQueueDir)) {
          logger.debug(`Queue directory does not exist: ${contentQueueDir}`);
          continue;
        }

        logger.info(`Processing ${contentType} from: ${contentQueueDir}`);

        for (const filepath of scanMediaFiles(contentQueueDir)) {
          if (!this.running) break;

          totalFilesProcessed++;

          try {
            const success = await this.processFile(filepath, contentType);
            if (success) {
              const ext = path.extname(filepath).toLowerCase();
              if (ext === '.mp4') {
                mp4FilesMoved++;
              } else {
                nonMp4FilesMoved++;
              }
              totalFilesSuccessful++;
            } else {
              totalFilesFailed++;
            }
          } catch (error) {
            logger.error(`Failed to process file ${filepath}: ${error}`);
            this.handleError(filepath, String(error));
            totalFilesFailed++;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Interrupted by user') {
        logger.error(`Processing failed: ${error}`);
        throw error;
      }
    } finally {
      if (this.dryRun) {
        logger.info(
          'DRY RUN COMPLETE - ' +
          `Total: ${totalFilesProcessed}, ` +
          `Successful: ${totalFilesSuccessful}, ` +
          `Failed: ${totalFilesFailed}, ` +
          `MP4 files that would be moved to upload: ${mp4FilesMoved}, ` +
          `Non-MP4 files that would be moved to transcode: ${nonMp4FilesMoved}`,
        );
      } else {
        logger.info(
          'Media renaming completed - ' +
          `Total: ${totalFilesProcessed}, ` +
          `Successful: ${totalFilesSuccessful}, ` +
          `Failed: ${totalFilesFailed}, ` +
          `MP4 files moved to upload: ${mp4FilesMoved}, ` +
          `Non-MP4 files moved to transcode: ${nonMp4FilesMoved}`,
        );
      }
    }
  }

  private setupDirectories(): void {
    const directories = [
      path.join(MEDIA_BASE_FOLDER, TRANSCODE_FOLDER, CONTENT_TYPE_MOVIES),
      path.join(MEDIA_BASE_FOLDER, TRANSCODE_FOLDER, CONTENT_TYPE_TV),
      path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER, CONTENT_TYPE_MOVIES),
      path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER, CONTENT_TYPE_TV),
      path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER),
    ];

    for (const dir of directories) {
      ensureDirectoryExists(dir);
      this.createdDirectories.add(dir);
    }

    // Pre-create error directory for renaming errors
    this.errorDir = createErrorDirectory(
      path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER),
      'renaming_errors',
    );
    this.createdDirectories.add(this.errorDir);
  }

  private async processFile(filepath: string, _contentType: string): Promise<boolean> {
    logger.info(`Processing file: ${filepath}`);

    try {
      // Parse filename
      const mediaInfo = parseMediaFile(filepath);
      logger.debug(`Parsed media info: ${JSON.stringify(mediaInfo)}`);

      // Lookup TMDb metadata
      const tmdbData = await this.lookupTmdbMetadata(mediaInfo);
      if (!tmdbData) {
        return this.handleError(filepath, 'TMDb lookup failed') < 0 ? false : true;
      }

      // Fetch episode title if TV show
      if (mediaInfo.content_type === CONTENT_TYPE_TV) {
        await this.fetchEpisodeTitleFromTmdb(mediaInfo, tmdbData);
      }

      // Format new path
      const newPath = this.formatNewPath(mediaInfo, tmdbData, filepath);
      logger.debug(`New path: ${newPath}`);

      // Move to appropriate destination
      return this.moveToDestination(filepath, newPath);
    } catch (error) {
      logger.error(`Processing failed for ${filepath}: ${error}`);
      return this.handleError(filepath, String(error)) < 0 ? false : true;
    }
  }

  private async lookupTmdbMetadata(mediaInfo: any): Promise<Record<string, any> | null> {
    try {
      let result;
      if (mediaInfo.content_type === CONTENT_TYPE_MOVIES) {
        result = await this.tmdbClient.findBestMovieMatch(mediaInfo.title, mediaInfo.year);
      } else {
        result = await this.tmdbClient.findBestTvMatch(
          mediaInfo.title,
          mediaInfo.year,
          this.useEpisodeTitles,
        );
      }

      if (result) {
        const displayName = result.title || result.name || 'Unknown';
        logger.debug(`Found TMDb match: ${displayName}`);
        return result;
      } else {
        logger.warning(`No TMDb match found for: ${mediaInfo.title}`);
        return null;
      }
    } catch (error) {
      logger.error(`TMDb lookup failed: ${error}`);
      return null;
    }
  }

  private async fetchEpisodeTitleFromTmdb(
    mediaInfo: any,
    tmdbData: Record<string, any>,
  ): Promise<void> {
    try {
      const season = mediaInfo.season;
      const episode = mediaInfo.episode;
      const tmdbId = tmdbData.id;

      if (!season || !episode || !tmdbId) {
        logger.debug('Missing season/episode/tmdb_id, skipping TMDb episode title fetch');
        if (!mediaInfo.episode_title) {
          mediaInfo.episode_title = `Episode ${String(episode).padStart(2, '0')}`;
        }
        return;
      }

      const episodeData = await this.tmdbClient.getEpisodeInfo(
        tmdbId,
        season,
        episode,
        mediaInfo.episode_title,
        this.useEpisodeTitles,
      );

      if (episodeData && episodeData.name) {
        const originalTitle = mediaInfo.episode_title || '';
        const newTitle = episodeData.name;
        mediaInfo.episode_title = newTitle;
        logger.info(`Updated episode title from TMDb: '${originalTitle}' -> '${newTitle}'`);

        if (episodeData.season_number && episodeData.season_number !== season) {
          logger.info(`Updated season from TMDb: ${season} -> ${episodeData.season_number}`);
          mediaInfo.season = episodeData.season_number;
        }

        if (episodeData.episode_number && episodeData.episode_number !== episode) {
          logger.info(`Updated episode from TMDb: ${episode} -> ${episodeData.episode_number}`);
          mediaInfo.episode = episodeData.episode_number;
        }
      } else {
        if (!mediaInfo.episode_title) {
          mediaInfo.episode_title = `Episode ${String(episode).padStart(2, '0')}`;
          logger.warning(
            `Could not fetch episode title for S${season}E${episode} from TMDb, using fallback: '${mediaInfo.episode_title}'`,
          );
        }
      }
    } catch (error) {
      logger.warning(`Failed to fetch episode title from TMDb: ${error}`);
      if (!mediaInfo.episode_title) {
        const episode = mediaInfo.episode || 0;
        mediaInfo.episode_title = `Episode ${String(episode).padStart(2, '0')}`;
      }
    }
  }

  private formatNewPath(mediaInfo: any, tmdbData: Record<string, any>, filepath: string): string {
    const tmdbId = tmdbData.id;
    const extension = path.extname(filepath);

    if (mediaInfo.content_type === CONTENT_TYPE_MOVIES) {
      return constructMoviePath(
        tmdbData.title,
        parseInt((tmdbData.release_date || '').substring(0, 4)) || mediaInfo.year,
        tmdbId,
        extension,
      );
    } else {
      return constructTvShowPath(
        tmdbData.name,
        parseInt((tmdbData.first_air_date || '').substring(0, 4)) || mediaInfo.year,
        tmdbId,
        mediaInfo.season,
        mediaInfo.episode,
        mediaInfo.episode_title,
        extension,
        tmdbData,
      );
    }
  }

  private ensureDirectoryCreatedOnce(dirPath: string): void {
    if (!this.createdDirectories.has(dirPath)) {
      ensureDirectoryExists(dirPath);
      this.createdDirectories.add(dirPath);
    }
  }

  private moveToDestination(source: string, newPath: string): boolean {
    const extension = path.extname(source).toLowerCase();
    const isMp4 = extension === '.mp4';

    const destinationDir = isMp4
      ? path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER)
      : path.join(MEDIA_BASE_FOLDER, TRANSCODE_FOLDER);

    logger.info(
      `${isMp4 ? 'MP4' : 'Non-MP4'} file detected, moving to ${isMp4 ? 'upload' : 'transcode'} folder`,
    );

    // Extract relative path from newPath
    let relativePath = newPath;
    if (relativePath.startsWith('../media/')) {
      relativePath = relativePath.substring(9);
    } else if (relativePath.startsWith('../')) {
      relativePath = relativePath.substring(3);
    }

    const destinationPath = path.join(destinationDir, relativePath);

    if (this.dryRun) {
      logger.info(`DRY RUN: Would move ${source} to ${destinationPath}`);
      return true;
    }

    // Ensure destination directory exists (only once per unique path)
    const destinationFileDir = path.dirname(destinationPath);
    this.ensureDirectoryCreatedOnce(destinationFileDir);

    const success = safeMove(source, destinationPath, this.errorDir);

    if (success) {
      const destinationRelative = path.relative(destinationDir, destinationPath);
      logger.info(`Successfully moved: ${path.basename(source)} -> ${destinationRelative}`);
    } else {
      logger.error(`Failed to move: ${path.basename(source)}`);
    }

    return success;
  }

  private handleError(filepath: string, errorMessage: string): number {
    logger.error(`Handling error for ${filepath}: ${errorMessage}`);

    if (this.dryRun) {
      logger.info(`DRY RUN: Would move ${filepath} to error directory`);
      return -1;
    }

    const errorDir = createErrorDirectory(
      path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER),
      'processing_errors',
    );
    const errorDestination = path.join(errorDir, path.basename(filepath));

    try {
      safeMove(filepath, errorDestination);
      return 1;
    } catch (error) {
      logger.error(`Failed to move error file: ${error}`);
      return -1;
    }
  }
}

async function main() {
  const program = new Command();

  program
    .name('media-renamer')
    .description('Plex media file renamer - handles parsing, TMDb lookup, and file organization')
    .argument('[source_dir]', 'Source directory containing media files')
    .option('--dry-run', 'Preview changes without making modifications', false)
    .option(
      '--use-episode-titles',
      'Use episode titles instead of S##E## numbers for TV shows',
      false,
    )
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action(async (sourceDir, options) => {
      const renamer = new MediaRenamer(options.dryRun, options.logLevel, options.useEpisodeTitles);

      try {
        await renamer.run(sourceDir);
      } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
      }
    });

  program.parse(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
