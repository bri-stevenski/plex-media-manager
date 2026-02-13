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

export class FileOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

/**
 * Get file size in bytes.
 */
export function getFileSize(filepath: string): number {
  try {
    const stats = fs.statSync(filepath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Get available disk space in bytes for a directory.
 */
export function getAvailableSpace(directory: string): number {
  try {
    const stats = fs.statSync(directory);
    // Note: This is a simplified implementation
    // In production, you might use a library like 'diskusage'
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Move a file from source to destination.
 */
function moveFile(source: string, destination: string, createDirs: boolean = true): void {
  try {
    if (!fs.existsSync(source)) {
      throw new FileOperationError(`Source file does not exist: ${source}`);
    }

    if (createDirs) {
      ensureDirectoryExists(path.dirname(destination));
    }

    fs.renameSync(source, destination);
    logger.debug(`Moved file: ${source} -> ${destination}`);
  } catch (error) {
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
export function ensureDirectoryExists(directory: string): void {
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
export function safeMove(
  source: string,
  destination: string,
  errorDir?: string,
): boolean {
  try {
    moveFile(source, destination);
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

/**
 * Create an error directory for a specific content type.
 */
export function createErrorDirectory(baseErrorDir: string, contentType: string): string {
  const errorDir = path.join(baseErrorDir, contentType);
  ensureDirectoryExists(errorDir);
  return errorDir;
}
