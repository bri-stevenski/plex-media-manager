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
  MEDIA_BASE_DIR,
  BACKUP_FOLDER,
  COMPLETED_FOLDER,
  FAILED_FOLDER,
  PROCESSING_FOLDER,
  QUEUE_FOLDER,
} from './utils/constants';
import {
  moveSidecarFiles,
  pruneEmptyDirectories,
  removeKnownQueueArtifacts,
  ensureDirectoryExists,
  safeMove,
  scanMediaFiles,
} from './utils/file-manager';
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
  private readonly processingRoot: string;
  private readonly queueRoot: string;
  private readonly failedRoot: string;
  private readonly backupRoot: string;
  private readonly processingSessionId: string;
  private readonly processingSessionRoot: string;
  private readonly tmdbClient: TMDbClient;
  private running: boolean;
  private activeSourceRoot: string | null;
  private sourceRoot: string | null;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    recursive: boolean = true,
    useEpisodeTitles: boolean = false,
    libraryRoot: string = MEDIA_BASE_DIR,
    outputSubfolder: string = COMPLETED_FOLDER,
  ) {
    this.dryRun = dryRun;
    this.recursive = recursive;
    this.useEpisodeTitles = useEpisodeTitles;
    this.libraryRoot = path.resolve(libraryRoot);
    this.destinationRoot = path.resolve(this.libraryRoot, outputSubfolder);
    this.processingRoot = path.resolve(this.libraryRoot, PROCESSING_FOLDER);
    this.queueRoot = path.resolve(this.libraryRoot, QUEUE_FOLDER);
    this.failedRoot = path.resolve(this.libraryRoot, FAILED_FOLDER);
    this.backupRoot = path.resolve(this.libraryRoot, BACKUP_FOLDER);
    this.processingSessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-pid${process.pid}`;
    this.processingSessionRoot = path.join(this.processingRoot, this.processingSessionId);
    this.running = true;
    this.activeSourceRoot = null;
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
      processing_root: this.processingRoot,
      failed_root: this.failedRoot,
      backup_root: this.backupRoot,
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
    this.activeSourceRoot = sourceRoot;

    let totalFilesProcessed = 0;
    let organized = 0;
    let skipped = 0;
    let failed = 0;

    const mediaFiles = Array.from(scanMediaFiles(sourceRoot, this.recursive));

    for (const filepath of mediaFiles) {
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

    this.cleanupQueueArtifacts(sourceRoot);

    const modePrefix = this.dryRun ? 'DRY RUN COMPLETE -' : 'Organization complete -';
    logger.info(
      `${modePrefix} Total: ${totalFilesProcessed}, Organized: ${organized}, Skipped: ${skipped}, Failed: ${failed}`,
    );
  }

  private cleanupQueueArtifacts(sourceRoot: string): void {
    if (this.dryRun) {
      return;
    }

    const relativeToQueue = path.relative(this.queueRoot, sourceRoot);
    if (relativeToQueue.startsWith('..') || path.isAbsolute(relativeToQueue)) {
      return;
    }

    let directories: string[] = [];

    try {
      directories = this.collectDirectories(sourceRoot);
      for (const dir of directories) {
        removeKnownQueueArtifacts(dir);
      }
    } catch (error) {
      logger.warning(`Queue artifact cleanup pass failed for ${sourceRoot}: ${error}`);
      return;
    }

    directories.sort((a, b) => b.length - a.length);
    for (const dir of directories) {
      try {
        pruneEmptyDirectories(dir, this.queueRoot);
      } catch (error) {
        logger.warning(`Failed pruning empty folders for ${dir}: ${error}`);
      }
    }
  }

  private collectDirectories(root: string): string[] {
    const directories: string[] = [];
    const stack = [root];

    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }

      directories.push(dir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        stack.push(path.join(dir, entry.name));
      }
    }

    return directories;
  }

  private getRelativeToSource(filepath: string): string {
    if (!this.sourceRoot) {
      return path.basename(filepath);
    }

    const relative = path.relative(this.sourceRoot, filepath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return path.basename(filepath);
    }

    return relative;
  }

  private stageToProcessing(sourcePath: string, relativePath: string): string | null {
    const stagedPath = path.join(this.processingSessionRoot, relativePath);

    try {
      ensureDirectoryExists(path.dirname(stagedPath));
    } catch (error) {
      logger.error(`Failed creating processing directory for ${stagedPath}: ${error}`);
      return null;
    }

    const staged = safeMove(sourcePath, stagedPath);
    if (!staged) {
      return null;
    }

    try {
      const sidecars = moveSidecarFiles(sourcePath, stagedPath);
      if (sidecars.moved || sidecars.skipped || sidecars.failed) {
        logger.info(
          `Staged sidecars - moved: ${sidecars.moved}, skipped: ${sidecars.skipped}, failed: ${sidecars.failed}`,
        );
      }
    } catch (error) {
      logger.warning(`Failed staging sidecars for ${sourcePath}: ${error}`);
    }

    try {
      const deletedArtifacts = removeKnownQueueArtifacts(path.dirname(sourcePath));
      if (deletedArtifacts > 0) {
        logger.info(`Deleted ${deletedArtifacts} queue artifact(s) from: ${path.dirname(sourcePath)}`);
      }
    } catch (error) {
      logger.warning(`Queue artifact cleanup failed for ${path.dirname(sourcePath)}: ${error}`);
    }

    try {
      const sourceDir = path.dirname(sourcePath);
      const pruneStop = this.getPruneStopFor(sourceDir);
      if (pruneStop) {
        pruneEmptyDirectories(sourceDir, pruneStop);
      }
    } catch (error) {
      logger.warning(`Failed pruning empty queue folders for ${path.dirname(sourcePath)}: ${error}`);
    }

    return stagedPath;
  }

  private getPruneStopFor(startDir: string): string | null {
    const candidates = [
      this.processingSessionRoot,
      this.queueRoot,
      this.sourceRoot,
      this.activeSourceRoot,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const relative = path.relative(candidate, startDir);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return candidate;
      }
    }

    return null;
  }

  private quarantineToBackup(sourcePath: string, relativePath: string): void {
    this.quarantineToRoot(sourcePath, relativePath, this.backupRoot, 'backups');
  }

  private quarantineToFailed(sourcePath: string, relativePath: string): void {
    this.quarantineToRoot(sourcePath, relativePath, this.failedRoot, 'failed');
  }

  private quarantineToRoot(
    sourcePath: string,
    relativePath: string,
    targetRoot: string,
    label: string,
  ): void {
    const destinationPath = path.join(targetRoot, relativePath);

    try {
      ensureDirectoryExists(path.dirname(destinationPath));
    } catch (error) {
      logger.error(`Failed creating ${label} directory for ${destinationPath}: ${error}`);
      return;
    }

    const moved = safeMove(sourcePath, destinationPath);
    if (!moved) {
      logger.error(`Failed quarantining to ${label}: ${sourcePath} -> ${destinationPath}`);
      return;
    }

    try {
      const sidecars = moveSidecarFiles(sourcePath, destinationPath);
      if (sidecars.moved || sidecars.skipped || sidecars.failed) {
        logger.info(
          `Quarantine sidecars (${label}) - moved: ${sidecars.moved}, skipped: ${sidecars.skipped}, failed: ${sidecars.failed}`,
        );
      }
    } catch (error) {
      logger.warning(`Sidecar quarantine failed (${label}) for ${sourcePath}: ${error}`);
    }

    try {
      const sourceDir = path.dirname(sourcePath);
      const deletedArtifacts = removeKnownQueueArtifacts(sourceDir);
      if (deletedArtifacts > 0) {
        logger.info(`Deleted ${deletedArtifacts} artifact(s) from: ${sourceDir}`);
      }
    } catch (error) {
      logger.warning(`Artifact cleanup failed (${label}) for ${path.dirname(sourcePath)}: ${error}`);
    }

    try {
      const sourceDir = path.dirname(sourcePath);
      const pruneStop = this.getPruneStopFor(sourceDir);
      if (pruneStop) {
        pruneEmptyDirectories(sourceDir, pruneStop);
      }
    } catch (error) {
      logger.warning(`Failed pruning empty folders after quarantine (${label}) for ${sourcePath}: ${error}`);
    }

    logger.info(`Quarantined to ${label}: ${path.relative(this.libraryRoot, destinationPath)}`);
  }

  private async processFile(filepath: string): Promise<FileResult> {
    logger.info(`Processing file: ${filepath}`);

    if (this.shouldSkipSupplementalFile(filepath)) {
      logger.info(`Skipping supplemental file: ${filepath}`);
      return 'skipped';
    }

    const relativePath = this.getRelativeToSource(filepath);
    let workingPath = filepath;

    if (!this.dryRun && this.sourceRoot) {
      const stagedPath = this.stageToProcessing(filepath, relativePath);
      if (!stagedPath) {
        this.quarantineToBackup(filepath, relativePath);
        return 'failed';
      }
      workingPath = stagedPath;
    }

    try {
      const mediaInfo = parseMediaFile(workingPath);
      logger.debug('Parsed media info', {
        filepath: workingPath.split(/[\\/]/).pop(),
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
          filepath: workingPath.split(/[\\/]/).pop(),
          lookup_type: mediaInfo.content_type,
          title: mediaInfo.title,
        });

        if (!this.dryRun) {
          this.quarantineToFailed(workingPath, relativePath);
        }

        return 'failed';
      }

      if (mediaInfo.content_type !== CONTENT_TYPE_MOVIES) {
        await this.enrichEpisodeMetadata(mediaInfo, tmdbData);
      }

      const destinationPath = this.buildDestinationPath(workingPath, mediaInfo, tmdbData);
      if (!destinationPath) {
        logger.warning(`Could not build destination path for ${workingPath}`);

        if (!this.dryRun) {
          this.quarantineToFailed(workingPath, relativePath);
        }

        return 'failed';
      }

      return this.moveToDestination(workingPath, destinationPath, relativePath);
    } catch (error) {
      logger.error(`Failed to process file ${workingPath}: ${error}`);
      if (!this.dryRun) {
        this.quarantineToFailed(workingPath, relativePath);
      }
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

  private moveToDestination(
    sourcePath: string,
    destinationPath: string,
    relativePath: string,
  ): FileResult {
    if (this.areSamePath(sourcePath, destinationPath)) {
      logger.debug(`Already organized: ${sourcePath}`);
      return 'skipped';
    }

    if (fs.existsSync(destinationPath)) {
      logger.error(`Destination already exists: ${destinationPath}`);
      if (!this.dryRun) {
        this.quarantineToFailed(sourcePath, relativePath);
      }
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
      this.quarantineToBackup(sourcePath, relativePath);
      return 'failed';
    }

    this.cleanupSourceAfterMove(sourcePath, destinationPath);

    logger.info(`Moved: ${sourceName} -> ${destinationRelative}`);
    return 'organized';
  }

  private cleanupSourceAfterMove(sourcePath: string, destinationPath: string): void {
    if (this.dryRun) {
      return;
    }

    const sourceDir = path.dirname(sourcePath);

    try {
      const sidecars = moveSidecarFiles(sourcePath, destinationPath);
      if (sidecars.moved || sidecars.skipped || sidecars.failed) {
        logger.info(`Sidecars - moved: ${sidecars.moved}, skipped: ${sidecars.skipped}, failed: ${sidecars.failed}`);
      }
    } catch (error) {
      logger.warning(`Sidecar move failed for ${sourcePath}: ${error}`);
    }

    try {
      const deletedArtifacts = removeKnownQueueArtifacts(sourceDir);
      if (deletedArtifacts > 0) {
        logger.info(`Deleted ${deletedArtifacts} queue artifact(s) from: ${sourceDir}`);
      }
    } catch (error) {
      logger.warning(`Queue artifact cleanup failed for ${sourceDir}: ${error}`);
    }

    try {
      const pruneStop = this.getPruneStopFor(sourceDir);
      if (pruneStop) {
        pruneEmptyDirectories(sourceDir, pruneStop);
      }
    } catch (error) {
      logger.warning(`Failed pruning empty folders for ${sourceDir}: ${error}`);
    }
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
      MEDIA_BASE_DIR,
    )
    .option(
      '--output-subfolder <name>',
      'Subfolder under library-root where organized files are written',
      COMPLETED_FOLDER,
    )
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action(async (sourceDir, options) => {
      try {
        const libraryRoot = path.resolve(options.libraryRoot || MEDIA_BASE_DIR);
        const queueRoot = path.resolve(libraryRoot, QUEUE_FOLDER);
        const processingRoot = path.resolve(libraryRoot, PROCESSING_FOLDER);
        const failedRoot = path.resolve(libraryRoot, FAILED_FOLDER);
        const backupRoot = path.resolve(libraryRoot, BACKUP_FOLDER);
        const destinationRoot = path.resolve(
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

        ensureDirectoryExists(libraryRoot);
        ensureDirectoryExists(processingRoot);
        ensureDirectoryExists(failedRoot);
        ensureDirectoryExists(backupRoot);
        ensureDirectoryExists(destinationRoot);

        if (!sourceDir) {
          ensureDirectoryExists(queueRoot);
        }

        const resolvedSource = sourceDir ? path.resolve(sourceDir) : queueRoot;

        const renamer = new MediaRenamer(
          options.dryRun || false,
          options.logLevel,
          options.recursive !== false,
          options.useEpisodeTitles || false,
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

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
