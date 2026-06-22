/**
 * File manager for handling media file operations.
 *
 * This module provides functions for scanning, moving, copying, and organizing
 * media files throughout the processing pipeline.
 */

import fs from 'fs';
import path from 'path';
import { VIDEO_EXTENSIONS, getLogger } from '../config';

const logger = getLogger();

class FileOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

/**
 * Render a caught filesystem error as an actionable suffix: the errno code plus
 * a recovery hint for the common cases, instead of leaking a raw `${error}`
 * (which stringifies unhelpfully and hides the one field worth acting on).
 */
function describeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `permission denied (${code}) — check write access to the destination`;
    case 'ENOSPC':
      return `no space left on device (${code})`;
    case 'EROFS':
      return `read-only filesystem (${code})`;
    case undefined:
      return error instanceof Error ? error.message : String(error);
    default:
      return code;
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
    throw new FileOperationError(
      `Source file no longer exists: ${source} — it may have been moved or deleted since the scan`,
    );
  }

  if (fs.existsSync(destination)) {
    throw new FileOperationError(
      `Destination already exists, refusing to overwrite: ${destination}`,
    );
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
          `Could not copy ${source} across devices to ${destination}: ${describeError(copyError)}`,
        );
      }
    }

    throw new FileOperationError(
      `Could not move ${source} to ${destination}: ${describeError(error)}`,
    );
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

  // Track directories by their resolved real path so symlinks that point back
  // to an ancestor (or to an already-scanned subtree) don't cause infinite
  // recursion. Legitimate non-cyclic symlinks are still followed.
  const visitedDirs = new Set<string>();

  const scanDir = function* (dir: string): Generator<string> {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch (error) {
      logger.warning(`Skipping unreadable directory during scan: ${dir}: ${error}`);
      return;
    }

    if (visitedDirs.has(realDir)) {
      logger.warning(`Skipping already-visited directory (possible symlink cycle): ${dir}`);
      return;
    }
    visitedDirs.add(realDir);

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
    throw new FileOperationError(
      `Could not create directory ${directory}: ${describeError(error)}`,
    );
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
  const resolvedStopDir = path.resolve(stopDir);
  const normalizeForComparison = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  const stopComparable = normalizeForComparison(resolvedStopDir);
  let current = path.resolve(startDir);
  const relativeToStop = path.relative(resolvedStopDir, current);

  if (relativeToStop.startsWith('..') || path.isAbsolute(relativeToStop)) {
    logger.debug(`Skip pruning: ${current} is outside ${resolvedStopDir}`);
    return 0;
  }

  let removed = 0;

  while (
    normalizeForComparison(current).startsWith(stopComparable) &&
    normalizeForComparison(current) !== stopComparable
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
    } catch (error) {
      logger.warning(`Failed to read directory during prune: ${current}: ${error}`);
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

/**
 * Backwards-compatible alias for pruneEmptyDirectories.
 */
export function pruneEmptyParentDirectories(startDir: string, stopAtDir: string): void {
  pruneEmptyDirectories(startDir, stopAtDir);
}
