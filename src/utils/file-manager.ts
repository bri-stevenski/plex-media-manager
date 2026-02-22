/**
 * File manager for handling media file operations.
 *
 * This module provides functions for scanning, moving, copying, and organizing
 * media files throughout the processing pipeline.
 */

import fs from 'fs';
import path from 'path';
import { VIDEO_EXTENSIONS } from './constants';
import { getLogger } from './logger';

const logger = getLogger();

class FileOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

/**
 * Move a file from source to destination.
 */
function moveFile(source: string, destination: string, createDirs: boolean = true): void {
  if (!fs.existsSync(source)) {
    throw new FileOperationError(`Source file does not exist: ${source}`);
  }

  if (createDirs) {
    ensureDirectoryExists(path.dirname(destination));
  }

  try {
    fs.renameSync(source, destination);
    logger.debug(`Moved file: ${source} -> ${destination}`);
    return;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'EXDEV') {
      // Cross-device rename (different drive/mount), fallback to copy + delete.
      try {
        fs.copyFileSync(source, destination);
        fs.unlinkSync(source);
        logger.debug(`Moved file via copy+delete: ${source} -> ${destination}`);
        return;
      } catch (copyError) {
        throw new FileOperationError(
          `Failed cross-device move ${source} to ${destination}: ${copyError}`,
        );
      }
    }

    throw new FileOperationError(`Failed to move file ${source} to ${destination}: ${error}`);
  }
}

/**
 * Scan a directory for media files.
 */
export function* scanMediaFiles(directory: string, recursive: boolean = true): Generator<string> {
  if (!fs.existsSync(directory)) {
    logger.warning(`Directory does not exist: ${directory}`);
    return;
  }

  if (!fs.statSync(directory).isDirectory()) {
    logger.error(`Path is not a directory: ${directory}`);
    return;
  }

  const scanDir = function* (dir: string): Generator<string> {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filepath = path.join(dir, file);
      const stats = fs.statSync(filepath);

      if (stats.isFile()) {
        const ext = path.extname(filepath).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          yield filepath;
        }
      } else if (stats.isDirectory() && recursive) {
        yield* scanDir(filepath);
      }
    }
  };

  yield* scanDir(directory);
}

/**
 * Ensure a directory exists, creating it if necessary.
 */
function ensureDirectoryExists(directory: string): void {
  try {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    logger.debug(`Ensured directory exists: ${directory}`);
  } catch (error) {
    throw new FileOperationError(`Failed to create directory ${directory}: ${error}`);
  }
}

/**
 * Safely move a file with error handling and backup.
 */
export function safeMove(source: string, destination: string, errorDir?: string): boolean {
  try {
    // Validate source file exists before moving
    if (!fs.existsSync(source)) {
      logger.error(`Source file does not exist: ${source}`);
      return false;
    }

    const sourceSize = fs.statSync(source).size;

    moveFile(source, destination);

    // Verify the move was successful
    if (!fs.existsSync(destination)) {
      logger.error(`Destination file does not exist after move: ${destination}`);
      return false;
    }

    if (fs.existsSync(source)) {
      logger.error(`Source file still exists after move (incomplete operation): ${source}`);
      return false;
    }

    // Verify destination file has expected size
    const destSize = fs.statSync(destination).size;
    if (sourceSize !== destSize) {
      logger.error(
        `File size mismatch after move. Expected ${sourceSize}, got ${destSize}: ${destination}`,
      );
      return false;
    }

    logger.debug(`Successfully verified move of ${path.basename(source)}`);
    return true;
  } catch (error) {
    logger.error(`Failed to move file ${source}: ${error}`);

    if (errorDir) {
      try {
        ensureDirectoryExists(errorDir);
        const errorDestination = path.join(errorDir, path.basename(source));
        moveFile(source, errorDestination);
        logger.warning(`Moved failed file to error directory: ${errorDestination}`);
        return false;
      } catch (backupError) {
        logger.error(`Failed to move file to error directory: ${backupError}`);
      }
    }

    return false;
  }
}
