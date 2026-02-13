#!/usr/bin/env node

/**
 * Plex Media Transcoder: Handles video transcoding and file organization.
 *
 * This script processes media files by:
 * - Scanning for non-MP4 files in transcode folder
 * - Analyzing files for transcoding needs
 * - Transcoding files to MP4 format for compatibility
 * - Moving completed files to upload folder
 * - Handling errors gracefully
 */

import path from 'path';
import pLimit from 'p-limit';
import { Command } from 'commander';
import {
  CONTENT_TYPE_MOVIES,
  CONTENT_TYPE_TV,
  DEFAULT_LOG_LEVEL,
  ERROR_FOLDER,
  LOG_DIR,
  MEDIA_BASE_FOLDER,
  TRANSCODE_FOLDER,
  UPLOAD_FOLDER,
  WORKERS,
} from './utils/constants';
import {
  createErrorDirectory,
  ensureDirectoryExists,
  safeMove,
  scanMediaFiles,
} from './utils/fileManager';
import { setupLogging, getLogger } from './utils/logger';
import {
  VideoInfo,
  cleanupAllProcesses,
  cleanupTranscodingArtifacts,
  getTranscodeOutputPath,
  needsTranscoding,
  transcodeVideo,
  validateTranscodedFile,
} from './utils/transcoder';

const logger = getLogger();

interface FileInfo {
  path: string;
  contentType: string;
  needsTranscoding: boolean;
  transcoded: boolean;
  videoInfo?: VideoInfo;
  transcodedPath?: string;
}

class MediaTranscoder {
  private dryRun: boolean;
  private logLevel: string;
  private workers: number;
  private running = true;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    workers: number = WORKERS,
  ) {
    this.dryRun = dryRun;
    this.logLevel = logLevel;
    this.workers = workers;

    setupLogging(logLevel, LOG_DIR, true);

    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());

    logger.info('Media Transcoder initialized', { dry_run: dryRun, workers });
  }

  private handleShutdown(): void {
    logger.info('Received shutdown signal, cleaning up...');
    this.running = false;
    cleanupAllProcesses();
    process.exit(0);
  }

  async run(sourceDir?: string): Promise<void> {
    const transcodeDir = sourceDir
      ? path.resolve(sourceDir)
      : path.resolve(MEDIA_BASE_FOLDER, TRANSCODE_FOLDER);

    logger.info(`Starting media transcoding from: ${transcodeDir}`);

    this.setupDirectories();

    let filesAttempted = 0;
    let filesMovedSuccessfully = 0;
    let filesFailedToMove = 0;
    let filesActuallyTranscoded = 0;
    let filesDidntNeedTranscoding = 0;

    try {
      // Phase 1: Scan and analyze
      const [filesToProcess, analysisErrors] = await this.scanAndAnalyze(transcodeDir);

      if (filesToProcess.length === 0) {
        logger.info('No files to process');
        return;
      }

      logger.info(`Found ${filesToProcess.length} files to process`);
      logger.info(`Analysis errors: ${analysisErrors}`);

      // Phase 2: Transcode files
      await this.parallelTranscode(filesToProcess);

      // Phase 3: Move to upload folder
      for (const fileInfo of filesToProcess) {
        if (!this.running) break;

        filesAttempted++;
        try {
          const success = await this.moveToUploadFolder(fileInfo);
          if (success) {
            filesMovedSuccessfully++;
            if (fileInfo.transcoded) {
              filesActuallyTranscoded++;
            } else {
              filesDidntNeedTranscoding++;
            }
          } else {
            filesFailedToMove++;
          }
        } catch (error) {
          logger.error(`Failed to move file ${fileInfo.path}: ${error}`);
          this.handleError(fileInfo.path, String(error));
          filesFailedToMove++;
        }
      }
    } catch (error) {
      logger.error(`Processing failed: ${error}`);
      throw error;
    } finally {
      cleanupAllProcesses();

      if (this.dryRun) {
        logger.info(
          `DRY RUN COMPLETE - ` +
            `Files attempted: ${filesAttempted}, ` +
            `Successfully moved: ${filesMovedSuccessfully}, ` +
            `Failed to move: ${filesFailedToMove}, ` +
            `Actually transcoded: ${filesActuallyTranscoded}, ` +
            `Didn't need transcoding: ${filesDidntNeedTranscoding}`,
        );
      } else {
        logger.info(
          `Media transcoding completed - ` +
            `Files attempted: ${filesAttempted}, ` +
            `Successfully moved: ${filesMovedSuccessfully}, ` +
            `Failed to move: ${filesFailedToMove}, ` +
            `Actually transcoded: ${filesActuallyTranscoded}, ` +
            `Didn't need transcoding: ${filesDidntNeedTranscoding}`,
        );
      }
    }
  }

  private setupDirectories(): void {
    const directories = [
      path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER, CONTENT_TYPE_MOVIES),
      path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER, CONTENT_TYPE_TV),
      path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER),
    ];

    for (const dir of directories) {
      ensureDirectoryExists(dir);
      logger.debug(`Ensured directory exists: ${dir}`);
    }
  }

  private async scanAndAnalyze(
    transcodeDir: string,
  ): Promise<[FileInfo[], number]> {
    const filesToProcess: FileInfo[] = [];
    let analysisErrors = 0;

    for (const contentType of [CONTENT_TYPE_MOVIES, CONTENT_TYPE_TV]) {
      if (!this.running) break;

      const contentDir = path.join(transcodeDir, contentType);

      const fs = require('fs');
      if (!fs.existsSync(contentDir)) {
        logger.debug(`Transcode directory does not exist: ${contentDir}`);
        continue;
      }

      logger.info(`Scanning ${contentType} from: ${contentDir}`);

      for (const filepath of scanMediaFiles(contentDir)) {
        if (!this.running) break;

        try {
          const fileInfo = this.analyzeFile(filepath, contentType);
          if (fileInfo) {
            filesToProcess.push(fileInfo);
          } else {
            analysisErrors++;
          }
        } catch (error) {
          logger.error(`Failed to analyze file ${filepath}: ${error}`);
          analysisErrors++;
        }
      }
    }

    return [filesToProcess, analysisErrors];
  }

  private analyzeFile(filepath: string, contentType: string): FileInfo | null {
    try {
      const extension = path.extname(filepath).toLowerCase();

      if (extension === '.mp4') {
        logger.debug(`MP4 file, no transcoding needed: ${path.basename(filepath)}`);
        return {
          path: filepath,
          contentType,
          needsTranscoding: false,
          transcoded: false,
        };
      }

      const videoInfo = new VideoInfo(filepath);
      const needsTrans = needsTranscoding(videoInfo);

      logger.debug(`File ${path.basename(filepath)} needs transcoding: ${needsTrans}`);

      return {
        path: filepath,
        contentType,
        needsTranscoding: needsTrans,
        transcoded: false,
        videoInfo: needsTrans ? videoInfo : undefined,
      };
    } catch (error) {
      logger.error(`Error analyzing file ${filepath}: ${error}`);
      return null;
    }
  }

  private async parallelTranscode(filesToProcess: FileInfo[]): Promise<void> {
    const filesToTranscode = filesToProcess.filter((f) => f.needsTranscoding);

    if (filesToTranscode.length === 0) {
      logger.info('No files need transcoding');
      return;
    }

    logger.info(`Transcoding ${filesToTranscode.length} files with ${this.workers} workers`);

    const limit = pLimit(this.workers);
    const tasks = filesToTranscode.map((fileInfo, index) =>
      limit(() => this.transcodeFile(fileInfo, index + 1, filesToTranscode.length)),
    );

    await Promise.all(tasks);
  }

  private async transcodeFile(fileInfo: FileInfo, index: number, total: number): Promise<void> {
    const filepath = fileInfo.path;

    if (this.dryRun) {
      logger.info(`DRY RUN: Would transcode ${filepath}`);
      fileInfo.transcodedPath = getTranscodeOutputPath(filepath);
      fileInfo.transcoded = true;
      return;
    }

    try {
      const outputPath = getTranscodeOutputPath(filepath);

      const success = await transcodeVideo(filepath, outputPath);

      if (success && (await validateTranscodedFile(filepath, outputPath))) {
        cleanupTranscodingArtifacts(filepath);

        // Remove original file
        const fs = require('fs');
        try {
          fs.unlinkSync(filepath);
          logger.info(`Removed original file after transcoding: ${path.basename(filepath)}`);
        } catch (error) {
          logger.warning(`Failed to remove original file: ${error}`);
        }

        fileInfo.transcodedPath = outputPath;
        fileInfo.transcoded = true;
        logger.info(`[${index}/${total}] Transcoded: ${path.basename(filepath)}`);
      } else {
        // Clean up failed transcode
        const fs = require('fs');
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        logger.error(`[${index}/${total}] Failed to transcode: ${path.basename(filepath)}`);
      }
    } catch (error) {
      logger.error(`Transcoding error for ${path.basename(filepath)}: ${error}`);
    }
  }

  private async moveToUploadFolder(fileInfo: FileInfo): Promise<boolean> {
    const finalPath = fileInfo.transcodedPath || fileInfo.path;
    const contentType = fileInfo.contentType;
    const uploadDir = path.join(MEDIA_BASE_FOLDER, UPLOAD_FOLDER, contentType);

    const fs = require('fs');
    if (!fs.existsSync(finalPath)) {
      logger.warning(`File not found, skipping: ${finalPath}`);
      return false;
    }

    let relativePath: string;
    try {
      const transcodeBase = path.join(MEDIA_BASE_FOLDER, TRANSCODE_FOLDER, contentType);
      relativePath = path.relative(transcodeBase, finalPath);
    } catch {
      relativePath = path.basename(finalPath);
    }

    const destinationPath = path.join(uploadDir, relativePath);

    if (this.dryRun) {
      logger.info(`DRY RUN: Would move ${finalPath} to ${destinationPath}`);
      return true;
    }

    const errorDir = createErrorDirectory(path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER), 'upload_errors');
    const success = safeMove(finalPath, destinationPath, errorDir);

    if (success) {
      logger.info(`Successfully moved to upload: ${relativePath}`);
    } else {
      logger.error(`Failed to move to upload: ${path.basename(finalPath)}`);
    }

    return success;
  }

  private handleError(filepath: string, errorMessage: string): boolean {
    logger.error(`Handling error for ${filepath}: ${errorMessage}`);

    if (this.dryRun) {
      logger.info(`DRY RUN: Would move ${filepath} to error directory`);
      return false;
    }

    const errorDir = createErrorDirectory(
      path.join(MEDIA_BASE_FOLDER, ERROR_FOLDER),
      'transcoding_errors',
    );
    const errorDestination = path.join(errorDir, path.basename(filepath));

    try {
      safeMove(filepath, errorDestination);
      return false;
    } catch (error) {
      logger.error(`Failed to move error file: ${error}`);
      return false;
    }
  }
}

async function main() {
  const program = new Command();

  program
    .name('media-transcoder')
    .description('Plex media file transcoder - handles video transcoding and file organization')
    .argument('[source_dir]', 'Source directory containing media files to transcode')
    .option('--dry-run', 'Preview changes without making modifications', false)
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .option('--workers <num>', `Number of worker processes (default: ${WORKERS})`, String(WORKERS))
    .action(async (sourceDir, options) => {
      const workers = parseInt(options.workers);
      const transcoder = new MediaTranscoder(options.dryRun, options.logLevel, workers);

      try {
        await transcoder.run(sourceDir);
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
