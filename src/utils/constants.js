"use strict";
/**
 * Constants and configuration settings for media processing.
 *
 * This module contains constants used by the rename CLI and TMDb integration.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_DIR = exports.DEFAULT_LOG_LEVEL = exports.LOG_LEVELS = exports.TMDB_BASE_URL = exports.TMDB_API_KEY = exports.QUALITY_FORMATS_REGEX = exports.DATE_REGEXES = exports.YEAR_REGEX = exports.SEASON_EPISODE_REGEX = exports.VIDEO_EXTENSIONS = exports.ORGANIZED_FOLDER = exports.QUEUE_FOLDER = exports.MEDIA_BASE_FOLDER = exports.CONTENT_TYPE_TV = exports.CONTENT_TYPE_MOVIES = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
// Content type constants
exports.CONTENT_TYPE_MOVIES = 'Movies';
exports.CONTENT_TYPE_TV = 'TV Shows';
// Folder name constants
// Resolve to a stable default: sibling "media" folder next to the repo.
// This avoids cwd-dependent behavior when commands are run from other directories.
const REPO_PARENT_DIR = path_1.default.resolve(__dirname, '..', '..', '..');
exports.MEDIA_BASE_FOLDER = process.env.MEDIA_BASE_FOLDER || path_1.default.join(REPO_PARENT_DIR, 'media');
exports.QUEUE_FOLDER = 'queue';
exports.ORGANIZED_FOLDER = 'organized';
// Accepted video file extensions
exports.VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm']);
// Regex patterns for filename parsing
exports.SEASON_EPISODE_REGEX = /(?:[Ss]\s*)?(\d{1,2})\s*[Xx]\s*(\d{1,2})|([Ss]\s*(\d{1,2})\s*[Ee]\s*(\d{1,2}))/;
exports.YEAR_REGEX = /(19|20)\d{2}/;
exports.DATE_REGEXES = [
    /(20\d{2}|19\d{2})[-_. ](0[1-9]|1[0-2])[-_. ](0[1-9]|[12]\d|3[01])/,
    /(0[1-9]|[12]\d|3[01])[-_. ](0[1-9]|1[0-2])[-_. ](20\d{2}|19\d{2})/,
];
exports.QUALITY_FORMATS_REGEX = /\b(480p|720p|1080p|2160p|4k|hdr|hdr10\+?|dv|web[- ]?dl|bluray|webrip|x264|x265|h\.264|h\.265|ddp?\d?\.?\d?|atmos|remux)\b/gi;
// TMDb API configuration
exports.TMDB_API_KEY = process.env.TMDB_API_KEY || '';
exports.TMDB_BASE_URL = 'https://api.themoviedb.org/3';
// Logging configuration
exports.LOG_LEVELS = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    WARNING: 30,
    ERROR: 40,
};
exports.DEFAULT_LOG_LEVEL = 'INFO';
exports.LOG_DIR = './.logs';
