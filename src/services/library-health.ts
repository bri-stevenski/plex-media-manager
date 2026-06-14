/**
 * Library health scanner.
 *
 * Checks for common issues that accumulate silently in a Plex library:
 *   - Zero-byte / empty files
 *   - Broken symlinks
 *   - Unmatched files (video files outside the expected Plex folder structure)
 *   - Duplicate content at different quality tiers (uses duplicate-detector)
 *   - Files with no sidecar subtitles
 *   - Oversized NFO / junk files left behind
 */

import fs from 'fs';
import path from 'path';
import { VIDEO_EXTENSIONS } from '../config/env.js';
import { detectQuality } from './duplicate-detector.js';
import { getLogger } from '../config/logger.js';

export type HealthIssueKind =
  | 'zero-byte'
  | 'broken-symlink'
  | 'unmatched-file'
  | 'duplicate-quality'
  | 'no-subtitles'
  | 'junk-file';

export interface HealthIssue {
  kind: HealthIssueKind;
  path: string;
  detail?: string;
}

export interface HealthReport {
  scannedFiles: number;
  issues: HealthIssue[];
  /** Convenience counts per issue kind */
  summary: Record<HealthIssueKind, number>;
}

// Matches Plex-standard movie folder: "Title (Year) {tmdb-id}"
const MOVIE_FOLDER_RE = /^.+\(\d{4}\)\s*\{tmdb-\d+\}$/;
// Matches Plex-standard TV show folder: "Title (Year) {tmdb-id}" or just a Season folder
const TV_FOLDER_RE = /^.+\(\d{4,}\)\s*\{tmdb-\d+\}$|^Season \d+$/i;

const JUNK_EXTENSIONS = new Set(['.nfo', '.txt', '.jpg', '.jpeg', '.png', '.ds_store', '.url']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

function* walkFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      yield full; // handled by broken-symlink check
    } else if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

function isBrokenSymlink(filePath: string): boolean {
  try {
    fs.statSync(filePath); // follows symlink; throws if target missing
    return false;
  } catch {
    return true;
  }
}

function hasSubtitle(videoPath: string): boolean {
  const base = videoPath.replace(/\.[^.]+$/, '');
  for (const ext of SUBTITLE_EXTENSIONS) {
    // Accept any language code: movie.en.srt, movie.srt, etc.
    if (fs.existsSync(`${base}${ext}`)) return true;
    // Glob-ish check for language-tagged variants
    const dir = path.dirname(videoPath);
    const stem = path.basename(base);
    try {
      const siblings = fs.readdirSync(dir);
      if (siblings.some((s) => s.startsWith(stem) && SUBTITLE_EXTENSIONS.has(path.extname(s)))) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function isUnmatchedVideoFile(filePath: string, libraryRoot: string): boolean {
  // A file is "unmatched" if it lives directly under the Movies/ or TV Shows/ root
  // rather than inside a properly-named show/movie folder.
  const rel = path.relative(libraryRoot, filePath);
  const parts = rel.split(path.sep);

  // Expected depth for movies: Movies/{Movie Folder (year) {tmdb-id}}/file.mkv  → parts.length === 3
  // Expected depth for TV:     TV Shows/{Show Folder}/Season XX/file.mkv          → parts.length === 4
  if (parts[0] === 'Movies') {
    return parts.length < 3 || !MOVIE_FOLDER_RE.test(parts[1]);
  }
  if (parts[0] === 'TV Shows') {
    return parts.length < 4;
  }
  return false; // outside known sections — not our concern
}

/**
 * Run all health checks against a library directory.
 *
 * @param libraryDir  The completed/organized library root (contains Movies/, TV Shows/)
 * @param checkSubtitles  Set to true to flag video files with no subtitle alongside
 */
export async function scanLibraryHealth(
  libraryDir: string,
  checkSubtitles = false,
): Promise<HealthReport> {
  const logger = getLogger();
  const issues: HealthIssue[] = [];
  let scannedFiles = 0;

  // Track video files per folder to detect same-content duplicate qualities
  const folderVideos: Map<string, string[]> = new Map();

  for (const filePath of walkFiles(libraryDir)) {
    scannedFiles++;
    const ext = path.extname(filePath).toLowerCase();
    const dir = path.dirname(filePath);

    // Broken symlink
    if (fs.lstatSync(filePath).isSymbolicLink() && isBrokenSymlink(filePath)) {
      issues.push({ kind: 'broken-symlink', path: filePath });
      continue;
    }

    // Junk file
    if (JUNK_EXTENSIONS.has(ext)) {
      issues.push({
        kind: 'junk-file',
        path: filePath,
        detail: `Leftover ${ext} file`,
      });
      continue;
    }

    if (!VIDEO_EXTENSIONS.has(ext)) continue;

    // Zero-byte video
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      issues.push({ kind: 'zero-byte', path: filePath });
      continue;
    }

    // Unmatched file (not in a properly-named Plex folder)
    if (isUnmatchedVideoFile(filePath, libraryDir)) {
      issues.push({ kind: 'unmatched-file', path: filePath, detail: 'Not inside a Plex-named folder' });
    }

    // Collect for duplicate quality check
    if (!folderVideos.has(dir)) folderVideos.set(dir, []);
    folderVideos.get(dir)!.push(filePath);

    // Missing subtitles
    if (checkSubtitles && !hasSubtitle(filePath)) {
      issues.push({ kind: 'no-subtitles', path: filePath });
    }
  }

  // Duplicate quality — same folder has multiple video files at different tiers
  for (const [folder, videos] of folderVideos) {
    if (videos.length < 2) continue;
    const qualities = videos.map((v) => ({ path: v, quality: detectQuality(v) }));
    const unique = new Set(qualities.map((q) => q.quality));
    if (unique.size > 1) {
      for (const v of qualities) {
        issues.push({
          kind: 'duplicate-quality',
          path: v.path,
          detail: `Multiple quality versions in same folder (${v.quality})`,
        });
      }
    }
  }

  const summary = {
    'zero-byte': 0,
    'broken-symlink': 0,
    'unmatched-file': 0,
    'duplicate-quality': 0,
    'no-subtitles': 0,
    'junk-file': 0,
  } as Record<HealthIssueKind, number>;

  for (const issue of issues) {
    summary[issue.kind]++;
  }

  logger.info('Library health scan complete', { scannedFiles, totalIssues: issues.length, ...summary });

  return { scannedFiles, issues, summary };
}
