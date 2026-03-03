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

const SIDECAR_EXTENSIONS = new Set([
  // Subtitles
  '.srt',
  '.ass',
  '.ssa',
  '.sub',
  '.idx',
  '.vtt',
  // Metadata
  '.nfo',
]);

const QUEUE_ARTIFACT_PATTERNS: ReadonlyArray<RegExp> = [
  /^rarbg\.txt$/i,
  /^rarbg_do_not_mirror\.exe$/i,
  /^www\.yts\.[^.]+\.(jpg|jpeg|png|txt)$/i,
  /^www\.yify-torrents\.com\.(jpg|jpeg|png|txt)$/i,
];

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

export type SidecarMoveSummary = {
  moved: number;
  skipped: number;
  failed: number;
};

/**
 * Move common "sidecar" files (subtitles, nfo, etc.) that match a media filename.
 *
 * Example:
 *   Movie.2024.mkv -> Movie (2024) {tmdb-123}.mkv
 *   Movie.2024.en.srt -> Movie (2024) {tmdb-123}.en.srt
 */
export function moveSidecarFiles(
  sourceMediaPath: string,
  destinationMediaPath: string,
): SidecarMoveSummary {
  const sourceDir = path.dirname(sourceMediaPath);
  const destinationDir = path.dirname(destinationMediaPath);

  const sourceStem = path.basename(sourceMediaPath, path.extname(sourceMediaPath));
  const destinationStem = path.basename(destinationMediaPath, path.extname(destinationMediaPath));

  if (!fs.existsSync(sourceDir)) {
    return { moved: 0, skipped: 0, failed: 0 };
  }

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (error) {
    logger.warning(`Failed to list sidecar candidates in ${sourceDir}: ${error}`);
    return { moved: 0, skipped: 0, failed: 0 };
  }

  const sourceStemLower = sourceStem.toLowerCase();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filename = entry.name;
    const extLower = path.extname(filename).toLowerCase();
    if (!SIDECAR_EXTENSIONS.has(extLower)) {
      continue;
    }

    const filenameLower = filename.toLowerCase();
    const matchesExactStem = filenameLower === `${sourceStemLower}${extLower}`;
    const matchesStemPrefix = filenameLower.startsWith(`${sourceStemLower}.`);
    if (!matchesExactStem && !matchesStemPrefix) {
      continue;
    }

    const suffix = filename.substring(sourceStem.length);
    const destinationFilename = `${destinationStem}${suffix}`;

    const sourcePath = path.join(sourceDir, filename);
    const destinationPath = path.join(destinationDir, destinationFilename);

    if (fs.existsSync(destinationPath)) {
      logger.warning(`Sidecar destination already exists, skipping: ${destinationPath}`);
      skipped++;
      continue;
    }

    const success = safeMove(sourcePath, destinationPath);
    if (success) {
      moved++;
      logger.info(`Moved sidecar: ${filename} -> ${destinationFilename}`);
    } else {
      failed++;
      logger.warning(`Failed moving sidecar: ${sourcePath} -> ${destinationPath}`);
    }
  }

  return { moved, skipped, failed };
}

/**
 * Remove common junk files left behind by download sources.
 */
export function removeKnownQueueArtifacts(directory: string): number {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return 0;
  }

  let deleted = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    logger.warning(`Failed to list queue artifacts in ${directory}: ${error}`);
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filename = entry.name;
    if (!QUEUE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(filename))) {
      continue;
    }

    const fullPath = path.join(directory, filename);
    try {
      fs.unlinkSync(fullPath);
      deleted++;
      logger.info(`Deleted queue artifact: ${fullPath}`);
    } catch (error) {
      logger.warning(`Failed deleting queue artifact ${fullPath}: ${error}`);
    }
  }

  return deleted;
}

/**
 * Remove empty directories upward from `startDir` until (but not including) `stopDir`.
 */
export function pruneEmptyDirectories(startDir: string, stopDir: string): number {
  const stopAbs = path.resolve(stopDir);
  let current = path.resolve(startDir);
  let removed = 0;

  while (true) {
    const relativeToStop = path.relative(stopAbs, current);
    if (relativeToStop.startsWith('..') || path.isAbsolute(relativeToStop)) {
      break;
    }

    if (current === stopAbs) {
      break;
    }

    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch (error) {
      logger.warning(`Failed to read directory during prune: ${current}: ${error}`);
export function pruneEmptyParentDirectories(startDir: string, stopAtDir: string): void {
  const resolvedStopAt = path.resolve(stopAtDir);
  const normalizeForComparison = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  const stopAtComparable = normalizeForComparison(resolvedStopAt);
  let current = path.resolve(startDir);
  const relativeToStop = path.relative(resolvedStopAt, current);

  if (relativeToStop.startsWith('..') || path.isAbsolute(relativeToStop)) {
    logger.debug(`Skip pruning: ${current} is outside ${resolvedStopAt}`);
    return;
  }

  while (
    normalizeForComparison(current).startsWith(stopAtComparable) &&
    normalizeForComparison(current) !== stopAtComparable
  ) {
    if (!fs.existsSync(current)) {
      break;
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(current);
    } catch {
      break;
    }

    if (!stats.isDirectory()) {
      break;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      break;
    }

    if (entries.length > 0) {
      break;
    }

    try {
      fs.rmdirSync(current);
      removed++;
      logger.debug(`Removed empty directory: ${current}`);
    } catch (error) {
      logger.warning(`Failed to remove empty directory ${current}: ${error}`);
      break;
    }

    current = path.dirname(current);
  }

  return removed;
}
