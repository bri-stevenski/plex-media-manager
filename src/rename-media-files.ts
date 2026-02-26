#!/usr/bin/env node

/**
 * TMDb-driven media organizer for Plex.
 *
 * Organizes files into Plex-friendly structure:
 * - Movies/<Title (Year) {tmdb-id}>/<Title (Year) {tmdb-id}>.ext
 * - TV Shows/<Show (Year) {tmdb-id}>/Season XX/<Show (Year) - sXXeYY - Episode.ext
 * - TV Shows/<Show (Year) {tmdb-id}>/Season XX/<Show (Year) - YYYY-MM-DD - Episode.ext
 */

import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import {
  CONTENT_TYPE_MOVIES,
  DEFAULT_LOG_LEVEL,
  LOG_DIR,
  MEDIA_BASE_FOLDER,
  ORGANIZED_FOLDER,
  QUEUE_FOLDER,
} from './utils/constants';
import { pruneEmptyParentDirectories, safeMove, scanMediaFiles } from './utils/file-manager';
import { setupLogging, getLogger } from './utils/logger';
import { parseMediaFile, type MediaInfo } from './utils/parser';
import {
  constructMoviePath,
  constructTvShowDatePath,
  constructTvShowPath,
} from './utils/formatter';
import { TMDbClient } from './utils/tmdb-client';

const logger = getLogger();

type FileResult = 'organized' | 'skipped' | 'failed';

class MediaRenamer {
  private readonly dryRun: boolean;
  private readonly recursive: boolean;
  private readonly useEpisodeTitles: boolean;
  private readonly libraryRoot: string;
  private readonly destinationRoot: string;
  private readonly tmdbClient: TMDbClient;
  private running: boolean;
  private sourceRoot: string | null;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    recursive: boolean = true,
    useEpisodeTitles: boolean = false,
    libraryRoot: string = MEDIA_BASE_FOLDER,
    outputSubfolder: string = ORGANIZED_FOLDER,
  ) {
    this.dryRun = dryRun;
    this.recursive = recursive;
    this.useEpisodeTitles = useEpisodeTitles;
    this.libraryRoot = path.resolve(libraryRoot);
    this.destinationRoot = path.resolve(this.libraryRoot, outputSubfolder);
    this.running = true;
    this.sourceRoot = null;

    setupLogging(logLevel, LOG_DIR, true);
    this.tmdbClient = new TMDbClient();

    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());

    logger.info('Media Renamer initialized', {
      dry_run: dryRun,
      recursive,
      use_episode_titles: useEpisodeTitles,
      library_root: this.libraryRoot,
      destination_root: this.destinationRoot,
    });
  }

  private handleShutdown(): void {
    logger.info('Received shutdown signal, exiting gracefully...');
    this.running = false;
    process.exit(0);
  }

  async run(sourceDir: string): Promise<void> {
    const sourceRoot = path.resolve(sourceDir);
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error(`Source directory not found: ${sourceRoot}`);
    }

    this.sourceRoot = sourceRoot;
    logger.info(`Starting TMDb organization from: ${sourceRoot}`);

    let totalFilesProcessed = 0;
    let organized = 0;
    let skipped = 0;
    let failed = 0;

    for (const filepath of scanMediaFiles(sourceRoot, this.recursive)) {
      if (!this.running) {
        break;
      }

      totalFilesProcessed++;
      const result = await this.processFile(filepath);
      if (result === 'organized') {
        organized++;
      } else if (result === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    const modePrefix = this.dryRun ? 'DRY RUN COMPLETE -' : 'Organization complete -';
    logger.info(
      `${modePrefix} Total: ${totalFilesProcessed}, Organized: ${organized}, Skipped: ${skipped}, Failed: ${failed}`,
    );
  }

  private async processFile(filepath: string): Promise<FileResult> {
    logger.info(`Processing file: ${filepath}`);

    try {
      if (this.shouldSkipSupplementalFile(filepath)) {
        logger.info(`Skipping supplemental file: ${filepath}`);
        return 'skipped';
      }

      const mediaInfo = parseMediaFile(filepath);
      logger.debug('Parsed media info', {
        filepath: filepath.split(/[\\/]/).pop(),
        content_type: mediaInfo.content_type,
        title: mediaInfo.title,
        year: mediaInfo.year,
      });
      const tmdbData = await this.lookupTmdbMetadata(mediaInfo);
      if (!tmdbData) {
        const reason =
          mediaInfo.content_type === CONTENT_TYPE_MOVIES
            ? `No movie match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`
            : `No TV show match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`;
        logger.warning(`Skipping file: ${reason}`, {
          filepath: filepath.split(/[\\/]/).pop(),
          lookup_type: mediaInfo.content_type,
          title: mediaInfo.title,
        });
        return 'failed';
      }

      if (mediaInfo.content_type !== CONTENT_TYPE_MOVIES) {
        await this.enrichEpisodeMetadata(mediaInfo, tmdbData);
      }

      const destinationPath = this.buildDestinationPath(filepath, mediaInfo, tmdbData);
      if (!destinationPath) {
        logger.warning(`Could not build destination path, skipping: ${filepath}`);
        return 'skipped';
      }

      return this.moveToDestination(filepath, destinationPath);
    } catch (error) {
      logger.error(`Failed to process file ${filepath}: ${error}`);
      return 'failed';
    }
  }

  private shouldSkipSupplementalFile(filepath: string): boolean {
    const segments = path
      .normalize(filepath)
      .split(path.sep)
      .map((segment) => segment.toLowerCase());

    const supplementalSegments = [
      'featurettes',
      'extras',
      'bonus',
      'bonus features',
      'behind the scenes',
      'deleted scenes',
      'trailers',
      'samples',
    ];

    return supplementalSegments.some((name) => segments.includes(name));
  }

  private async lookupTmdbMetadata(mediaInfo: MediaInfo): Promise<Record<string, any> | null> {
    const cleanTitle = (mediaInfo.title || '').trim();
    if (!cleanTitle) {
      logger.warning('Parsed title is empty; cannot query TMDb');
      return null;
    }

    if (mediaInfo.content_type === CONTENT_TYPE_MOVIES) {
      return this.tmdbClient.findBestMovieMatch(cleanTitle, mediaInfo.year || undefined);
    }

    return this.tmdbClient.findBestTvMatch(
      cleanTitle,
      mediaInfo.year || undefined,
      this.useEpisodeTitles,
    );
  }

  private async enrichEpisodeMetadata(
    mediaInfo: MediaInfo,
    tmdbData: Record<string, any>,
  ): Promise<void> {
    if (!tmdbData.id) {
      return;
    }

    if (mediaInfo.date_str) {
      try {
        const dateEpisodeData = await this.tmdbClient.getEpisodeByAirDate(
          tmdbData.id,
          mediaInfo.date_str,
        );

        if (dateEpisodeData) {
          if (typeof dateEpisodeData.name === 'string' && dateEpisodeData.name.trim().length > 0) {
            mediaInfo.episode_title = dateEpisodeData.name.trim();
          }

          if (typeof dateEpisodeData.season_number === 'number') {
            mediaInfo.season = dateEpisodeData.season_number;
          }

          if (typeof dateEpisodeData.episode_number === 'number') {
            mediaInfo.episode = dateEpisodeData.episode_number;
          }

          return;
        }
      } catch (error) {
        logger.warning(`TMDb air-date episode lookup failed for ${mediaInfo.title}: ${error}`);
      }
    }

    if (mediaInfo.season === null || mediaInfo.episode === null) {
      return;
    }

    try {
      const episodeData = await this.tmdbClient.getEpisodeInfo(
        tmdbData.id,
        mediaInfo.season,
        mediaInfo.episode,
        mediaInfo.episode_title || undefined,
        this.useEpisodeTitles,
      );

      if (!episodeData) {
        return;
      }

      if (typeof episodeData.name === 'string' && episodeData.name.trim().length > 0) {
        mediaInfo.episode_title = episodeData.name.trim();
      }

      if (typeof episodeData.season_number === 'number') {
        mediaInfo.season = episodeData.season_number;
      }

      if (typeof episodeData.episode_number === 'number') {
        mediaInfo.episode = episodeData.episode_number;
      }
    } catch (error) {
      logger.warning(`TMDb episode enrichment failed for ${mediaInfo.title}: ${error}`);
    }
  }

  private buildDestinationPath(
    filepath: string,
    mediaInfo: MediaInfo,
    tmdbData: Record<string, any>,
  ): string | null {
    const tmdbId = Number(tmdbData.id);
    if (!Number.isFinite(tmdbId)) {
      logger.error(`Invalid TMDb ID in result: ${JSON.stringify(tmdbData)}`);
      return null;
    }

    const extension = path.extname(filepath);

    if (mediaInfo.content_type === CONTENT_TYPE_MOVIES) {
      const movieTitle = String(tmdbData.title || mediaInfo.title || '').trim();
      const tmdbYear = this.extractYear(tmdbData.release_date);
      let movieYear = tmdbYear || mediaInfo.year;

      if (mediaInfo.year && tmdbYear && Math.abs(mediaInfo.year - tmdbYear) > 1) {
        logger.warning(
          `Movie year mismatch for '${movieTitle}': parsed ${mediaInfo.year}, TMDb ${tmdbYear}. Using parsed year for naming.`,
        );
        movieYear = mediaInfo.year;
      }

      if (!movieTitle || !movieYear) {
        logger.warning(`Missing movie title/year for ${filepath}`);
        return null;
      }

      return constructMoviePath(movieTitle, movieYear, tmdbId, extension, this.destinationRoot);
    }

    const seriesTitle = String(tmdbData.name || mediaInfo.title || '').trim();
    const seriesYear = this.extractYear(tmdbData.first_air_date) || mediaInfo.year;

    if (!seriesTitle) {
      logger.warning(`Missing series title for TV file: ${filepath}`);
      return null;
    }

    if (mediaInfo.date_str) {
      const seasonForFolder = mediaInfo.season ?? 1;
      return constructTvShowDatePath(
        seriesTitle,
        seriesYear || null,
        tmdbId,
        seasonForFolder,
        mediaInfo.date_str,
        mediaInfo.episode_title,
        extension,
        this.destinationRoot,
      );
    }

    if (mediaInfo.season === null || mediaInfo.episode === null) {
      logger.warning(`Missing season/episode info for TV file: ${filepath}`);
      return null;
    }

    const episodeStr = String(mediaInfo.episode).padStart(2, '0');
    const episodeTitle = mediaInfo.episode_title || `Episode ${episodeStr}`;

    return constructTvShowPath(
      seriesTitle,
      seriesYear || null,
      tmdbId,
      mediaInfo.season,
      mediaInfo.episode,
      episodeTitle,
      extension,
      this.destinationRoot,
    );
  }

  private moveToDestination(sourcePath: string, destinationPath: string): FileResult {
    if (this.areSamePath(sourcePath, destinationPath)) {
      logger.debug(`Already organized: ${sourcePath}`);
      return 'skipped';
    }

    if (fs.existsSync(destinationPath)) {
      logger.error(`Destination already exists: ${destinationPath}`);
      return 'failed';
    }

    const sourceName = path.basename(sourcePath);
    const destinationRelative = path.relative(this.libraryRoot, destinationPath);

    if (this.dryRun) {
      logger.info(`DRY RUN: ${sourceName} -> ${destinationRelative}`);
      return 'organized';
    }

    const success = safeMove(sourcePath, destinationPath);
    if (!success) {
      logger.error(`Move failed: ${sourcePath} -> ${destinationPath}`);
      return 'failed';
    }

    if (this.sourceRoot) {
      pruneEmptyParentDirectories(path.dirname(sourcePath), this.sourceRoot);
    }

    logger.info(`Moved: ${sourceName} -> ${destinationRelative}`);
    return 'organized';
  }

  private extractYear(dateLike: unknown): number | null {
    if (typeof dateLike !== 'string') {
      return null;
    }

    const match = /^(\d{4})/.exec(dateLike.trim());
    if (!match) {
      return null;
    }

    const parsed = Number(match[1]);
    if (parsed < 1900 || parsed > 2099) {
      return null;
    }

    return parsed;
  }

  private areSamePath(left: string, right: string): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    if (process.platform === 'win32') {
      return a.toLowerCase() === b.toLowerCase();
    }
    return a === b;
  }
}

async function main() {
  const program = new Command();

  program
    .name('media-renamer')
    .description('TMDb-based media organizer for Plex naming and folder conventions')
    .argument(
      '[source_dir]',
      'Source directory to scan. Defaults to <library_root>/queue if omitted.',
    )
    .option('--dry-run', 'Preview changes without making modifications')
    .option('--no-recursive', 'Only scan source_dir, not nested directories')
    .option(
      '--use-episode-titles',
      'Use parsed episode titles to help TMDb identify correct episode numbers',
    )
    .option(
      '--library-root <path>',
      'Root media folder that contains source and destination media folders',
      MEDIA_BASE_FOLDER,
    )
    .option(
      '--output-subfolder <name>',
      'Subfolder under library-root where organized files are written',
      ORGANIZED_FOLDER,
    )
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action(async (sourceDir, options) => {
      const libraryRoot = path.resolve(options.libraryRoot || MEDIA_BASE_FOLDER);
      const resolvedSource = sourceDir
        ? path.resolve(sourceDir)
        : path.join(libraryRoot, QUEUE_FOLDER);

      const renamer = new MediaRenamer(
        options.dryRun || false,
        options.logLevel,
        options.recursive !== false,
        options.useEpisodeTitles || false,
        libraryRoot,
        options.outputSubfolder || ORGANIZED_FOLDER,
      );

      try {
        await renamer.run(resolvedSource);
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
