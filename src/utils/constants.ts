/**
 * Constants and configuration settings for media processing.
 *
 * This module contains constants for video processing tasks, including default
 * extensions for video files, status codes, content type categories, and folder
 * naming conventions for organization.
 */

import dotenv from 'dotenv';

dotenv.config();

// Content type constants
export const CONTENT_TYPE_MOVIES = 'Movies';
export const CONTENT_TYPE_TV = 'TV Shows';

// Folder name constants
// All paths are relative to plex-media-tool directory where script is run
export const MEDIA_BASE_FOLDER = '../media';
export const RENAME_FOLDER = 'rename';
export const ERROR_FOLDER = 'errors';
export const TRANSCODE_FOLDER = 'transcode';
export const UPLOAD_FOLDER = 'upload';

// Run settings
export const DEBUG = false;
export const WORKERS = 4;

// Estimated processing parameters
export const EST_AVG_SPEED = 1.5; // Estimated average speed multiplier for processing (45min -> ~30min)
export const EST_AVG_VIDEO_LENGTH = 2700; // Estimated average video length in seconds (45 minutes)

// Accepted video file extensions
export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm']);

// Regex patterns for filename parsing
export const SEASON_EPISODE_REGEX =
  /(?:[Ss]\s*)?(\d{1,2})\s*[Xx]\s*(\d{1,2})|([Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,2}))/;
export const TMDB_ID_REGEX = /tmdb-\d+/;
export const YEAR_REGEX = /(19|20)\d{2}/;
export const DATE_REGEXES = [/(20\d{2}|19\d{2})[-_. ](0[1-9]|1[0-2])[-_. ](0[1-9]|[12]\d|3[01])/];
export const QUALITY_FORMATS_REGEX =
  /\b(480p|720p|1080p|2160p|4k|hdr|hdr10\+?|dv|web[- ]?dl|bluray|webrip|x264|x265|h\.264|h\.265|ddp?\d?\.?\d?|atmos|remux)\b/gi;

// TMDb API configuration
export const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original';

// Transcoding settings for Apple TV compatibility
export const TRANSCODE_SETTINGS = {
  video_codec: 'libx264',
  audio_codec: 'aac',
  preset: 'medium',
  crf: 23,
  audio_bitrate: '128k',
  max_audio_channels: 2,
};

// Logging configuration
export const LOG_LEVELS: Record<string, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  WARNING: 30,
  ERROR: 40,
};
export const DEFAULT_LOG_LEVEL = 'INFO';
export const LOG_DIR = './.logs';
