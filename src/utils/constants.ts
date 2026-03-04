/**
 * Constants and configuration settings for media processing.
 *
 * This module contains constants used by the rename CLI and TMDb integration.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Content type constants
export const CONTENT_TYPE_MOVIES = 'Movies';
export const CONTENT_TYPE_TV = 'TV Shows';

function normalizeSubfolder(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  // Treat values as subfolders under MEDIA_BASE_DIR, even if users include leading/trailing slashes.
  // This avoids cross-platform surprises where `/queue` would become an absolute path on POSIX.
  const withoutLeadingSeparators = trimmed.replace(/^[/\\]+/, '');
  const withoutTrailingSeparators = withoutLeadingSeparators.replace(/[/\\]+$/, '');

  return withoutTrailingSeparators.length > 0 ? withoutTrailingSeparators : fallback;
}

// Folder name constants
// Resolve to a stable default: sibling "media" folder next to the repo.
// This avoids cwd-dependent behavior when commands are run from other directories.
const REPO_DIR = path.resolve(__dirname, '..', '..');
const REPO_PARENT_DIR = path.resolve(REPO_DIR, '..');
const DEFAULT_MEDIA_BASE_DIR = path.join(REPO_PARENT_DIR, 'media');
export const MEDIA_BASE_DIR = path.resolve(
  REPO_DIR,
  (process.env.MEDIA_BASE_DIR ?? '').trim() || DEFAULT_MEDIA_BASE_DIR,
);

// Support both *_FOLDER and legacy *_DIR env vars (e.g. QUEUE_DIR) for compatibility with existing .env files.
export const QUEUE_FOLDER = normalizeSubfolder(
  process.env.QUEUE_FOLDER ?? process.env.QUEUE_DIR,
  'queue',
);
export const PROCESSING_FOLDER = normalizeSubfolder(
  process.env.PROCESSING_FOLDER ?? process.env.PROCESSING_DIR,
  'processing',
);
export const COMPLETED_FOLDER = normalizeSubfolder(
  process.env.COMPLETED_FOLDER ??
    process.env.COMPLETED_DIR ??
    process.env.PROCESSED_FOLDER ??
    process.env.PROCESSED_DIR,
  'completed',
);
export const FAILED_FOLDER = normalizeSubfolder(
  process.env.FAILED_FOLDER ?? process.env.FAILED_DIR,
  'failed',
);
export const BACKUP_FOLDER = normalizeSubfolder(
  process.env.BACKUP_FOLDER ?? process.env.BACKUP_DIR,
  'backups',
);

// Accepted video file extensions
export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm']);

// Regex patterns for filename parsing
export const SEASON_EPISODE_REGEX =
  /(?:[Ss]\s*)?(\d{1,2})\s*[Xx]\s*(\d{1,2})|([Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,2}))/;
export const YEAR_REGEX = /(19|20)\d{2}/;
export const DATE_REGEXES = [
  /(20\d{2}|19\d{2})[-_. ](0[1-9]|1[0-2])[-_. ](0[1-9]|[12]\d|3[01])/,
  /(0[1-9]|[12]\d|3[01])[-_. ](0[1-9]|1[0-2])[-_. ](20\d{2}|19\d{2})/,
];
export const QUALITY_FORMATS_REGEX =
  /\b(480p|720p|1080p|2160p|4k|hdr|hdr10\+?|dv|web[- ]?dl|bluray|webrip|x264|x265|h\.264|h\.265|ddp?\d?\.?\d?|atmos|remux)\b/gi;

// TMDb API configuration
export const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Logging configuration
export const LOG_LEVELS: Record<string, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  WARNING: 30,
  ERROR: 40,
};
export const DEFAULT_LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
export const LOG_DIR = './.logs';
