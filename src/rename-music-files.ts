#!/usr/bin/env node

/**
 * Music file organizer for Plex using metadata sources like MusicBrainz.
 *
 * Organizes music files into Plex-friendly structure:
 * - Music/<Artist>/<Album>/<Title>.ext
 * - Music/<Artist>/<Album (Year)>/<Album> - <Track> - <Title>.ext
 */

import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import {
  DEFAULT_LOG_LEVEL,
  LOG_DIR,
  MEDIA_BASE_FOLDER,
  ORGANIZED_FOLDER,
  QUEUE_FOLDER,
} from './utils/constants';
import { safeMove, scanMediaFiles } from './utils/file-manager';
import { setupLogging, getLogger } from './utils/logger';

const logger = getLogger();

type FileResult = 'organized' | 'skipped' | 'failed';

class MusicOrganizer {
  private readonly dryRun: boolean;
  private readonly recursive: boolean;
  private readonly libraryRoot: string;
  private readonly destinationRoot: string;
  private running: boolean;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    recursive: boolean = true,
  ) {
    setupLogging(logLevel);
    this.dryRun = dryRun;
    this.recursive = recursive;
    this.libraryRoot = path.resolve(MEDIA_BASE_FOLDER, '..', 'music');
    this.destinationRoot = path.join(this.libraryRoot, ORGANIZED_FOLDER);
    this.running = false;
  }

  /**
   * Scans music files in the queue folder and organizes them.
   */
  async organize(): Promise<void> {
    if (this.running) {
      logger.warning('Organization already in progress, aborting duplicate run.');
      return;
    }

    this.running = true;

    try {
      const queueFolder = path.join(this.libraryRoot, QUEUE_FOLDER);

      if (!fs.existsSync(queueFolder)) {
        logger.info(`Queue folder does not exist: ${queueFolder}`);
        logger.info('Nothing to organize.');
        return;
      }

      logger.info(`Starting music organization from: ${queueFolder}`);
      logger.info(`Destination: ${this.destinationRoot}`);

      if (this.dryRun) {
        logger.info('🔍 DRY RUN MODE - Files will NOT be moved');
      }

      const musicFileExtensions = ['.mp3', '.flac', '.aac', '.ogg', '.wav', '.alac'];
      const musicFiles = Array.from(scanMediaFiles(queueFolder, this.recursive)).filter(
        (file) => musicFileExtensions.some((ext) => file.toLowerCase().endsWith(ext)),
      );

      logger.info(`Found ${musicFiles.length} music files to process`);

      if (musicFiles.length === 0) {
        logger.info('No music files to organize.');
        return;
      }

      let organized = 0,
        skipped = 0,
        failed = 0;

      for (const file of musicFiles) {
        try {
          const result = await this.processFile(file);
          if (result === 'organized') organized++;
          else if (result === 'skipped') skipped++;
          else failed++;
        } catch (error) {
          logger.error(`Error processing ${file}: ${error}`);
          failed++;
        }
      }

      logger.info(`\n📊 Organization Summary:`);
      logger.info(`✅ Organized: ${organized}`);
      logger.info(`⏭️  Skipped: ${skipped}`);
      logger.info(`❌ Failed: ${failed}`);
    } catch (error) {
      logger.error(`Fatal error during organization: ${error}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * Processes a single music file.
   * Note: Actual metadata parsing and path construction to be implemented
   * with MusicBrainz or similar service.
   */
  private async processFile(file: string): Promise<FileResult> {
    // TODO: Implement music file metadata parsing
    // TODO: Query MusicBrainz or similar service for metadata
    // TODO: Construct Plex-friendly path: Music/<Artist>/<Album>/<Title>
    // TODO: Move file to organized location

    logger.debug(`Processing: ${file}`);
    // Placeholder: currently skip all files
    return 'skipped';
  }
}

const program = new Command();

program
  .name('plex-music-organizer')
  .description('Organize music files for Plex using metadata sources')
  .version('1.0.0')
  .option('--dry-run', 'Preview changes without moving files', false)
  .option(
    '--log-level <level>',
    'Set logging level (DEBUG, INFO, WARN, ERROR)',
    DEFAULT_LOG_LEVEL,
  )
  .option(
    '--no-recursive',
    'Do not recursively scan subdirectories',
    true,
  )
  .action(async (options) => {
    try {
      const organizer = new MusicOrganizer(
        options.dryRun,
        options.logLevel,
        options.recursive,
      );

      await organizer.organize();
    } catch (error) {
      logger.error(`Application error: ${error}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
