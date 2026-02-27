"use strict";
/**
 * Filename formatter for creating Plex-compliant media file names.
 *
 * This module provides functions to format media filenames according to
 * Plex naming conventions for both movies and TV shows.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.constructMoviePath = constructMoviePath;
exports.constructTvShowPath = constructTvShowPath;
exports.constructTvShowDatePath = constructTvShowDatePath;
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const logger = (0, logger_1.getLogger)();
/**
 * Remove characters that are problematic in filenames.
 */
function sanitizeFilename(text) {
    const invalidChars = /[<>:"/\\|?*]/g;
    return text.replace(invalidChars, '').trim();
}
/**
 * Format a movie filename according to Plex conventions.
 */
function formatMovieName(title, year, tmdbId) {
    const cleanTitle = title.trim().split(/\s+/).join(' ');
    const sanitized = sanitizeFilename(cleanTitle);
    const name = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
    logger.debug(`Formatted movie folder & file name: ${name}`);
    return name;
}
/**
 * Format a TV show episode filename according to Plex conventions.
 */
function formatEpisodeFilename(seriesTitle, seriesYear, season, episode, episodeTitle, extension) {
    const cleanTitle = seriesTitle.trim().split(/\s+/).join(' ');
    const sanitized = sanitizeFilename(cleanTitle);
    const seriesLabel = seriesYear ? `${sanitized} (${seriesYear})` : sanitized;
    const seasonStr = String(season).padStart(2, '0');
    const episodeStr = String(episode).padStart(2, '0');
    let cleanEpisodeTitle;
    if (!episodeTitle || episodeTitle.trim().length === 0) {
        cleanEpisodeTitle = `Episode ${episodeStr}`;
        logger.warning(`Missing episode title, using fallback: ${cleanEpisodeTitle}`);
    }
    else {
        cleanEpisodeTitle = episodeTitle.trim().split(/\s+/).join(' ');
        cleanEpisodeTitle = sanitizeFilename(cleanEpisodeTitle);
    }
    const filename = `${seriesLabel} - s${seasonStr}e${episodeStr} - ${cleanEpisodeTitle}${extension}`;
    logger.debug(`Formatted TV filename: ${filename}`);
    return filename;
}
/**
 * Format a date-based TV episode filename according to Plex conventions.
 */
function formatDateEpisodeFilename(seriesTitle, seriesYear, airDate, episodeTitle, extension) {
    const cleanTitle = seriesTitle.trim().split(/\s+/).join(' ');
    const sanitized = sanitizeFilename(cleanTitle);
    const seriesLabel = seriesYear ? `${sanitized} (${seriesYear})` : sanitized;
    if (!episodeTitle || episodeTitle.trim().length === 0) {
        const filename = `${seriesLabel} - ${airDate}${extension}`;
        logger.debug(`Formatted date-based TV filename: ${filename}`);
        return filename;
    }
    const cleanEpisodeTitle = sanitizeFilename(episodeTitle.trim().split(/\s+/).join(' '));
    const filename = `${seriesLabel} - ${airDate} - ${cleanEpisodeTitle}${extension}`;
    logger.debug(`Formatted date-based TV filename: ${filename}`);
    return filename;
}
/**
 * Format a movie folder name according to Plex conventions.
 */
function formatMovieFolderName(title, year, tmdbId) {
    const cleanTitle = title.trim().split(/\s+/).join(' ');
    const sanitized = sanitizeFilename(cleanTitle);
    const folderName = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
    logger.debug(`Formatted movie folder name: ${folderName}`);
    return folderName;
}
/**
 * Format a TV show folder name according to Plex conventions.
 */
function formatTvShowFolderName(title, year, tmdbId) {
    const cleanTitle = title.trim().split(/\s+/).join(' ');
    const sanitized = sanitizeFilename(cleanTitle);
    let folderName;
    if (year) {
        folderName = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
    }
    else {
        // No year available
        folderName = `${sanitized} {tmdb-${tmdbId}}`;
    }
    logger.debug(`Formatted TV show folder name: ${folderName}`);
    return folderName;
}
/**
 * Format a season folder name according to Plex conventions.
 */
function formatSeasonFolderName(season) {
    const seasonStr = String(season).padStart(2, '0');
    const folderName = `Season ${seasonStr}`;
    logger.debug(`Formatted season folder name: ${folderName}`);
    return folderName;
}
/**
 * Construct the full path for a movie file.
 */
function constructMoviePath(title, year, tmdbId, extension, baseFolder = constants_1.MEDIA_BASE_FOLDER) {
    const movieFolderName = formatMovieFolderName(title, year, tmdbId);
    const movieName = formatMovieName(title, year, tmdbId);
    return path_1.default.join(baseFolder, 'Movies', movieFolderName, `${movieName}${extension}`);
}
/**
 * Construct the full path for a TV show episode file.
 */
function constructTvShowPath(title, year, tmdbId, season, episode, episodeTitle, extension, baseFolder = constants_1.MEDIA_BASE_FOLDER) {
    const showFolderName = formatTvShowFolderName(title, year, tmdbId);
    const showFolder = path_1.default.join(baseFolder, 'TV Shows', showFolderName);
    const seasonFolderName = formatSeasonFolderName(season);
    const seasonFolder = path_1.default.join(showFolder, seasonFolderName);
    const filename = formatEpisodeFilename(title, year, season, episode, episodeTitle, extension);
    return path_1.default.join(seasonFolder, filename);
}
/**
 * Construct the full path for a date-based TV show episode file.
 */
function constructTvShowDatePath(title, year, tmdbId, season, airDate, episodeTitle, extension, baseFolder = constants_1.MEDIA_BASE_FOLDER) {
    const showFolderName = formatTvShowFolderName(title, year, tmdbId);
    const showFolder = path_1.default.join(baseFolder, 'TV Shows', showFolderName);
    const seasonFolderName = formatSeasonFolderName(season);
    const seasonFolder = path_1.default.join(showFolder, seasonFolderName);
    const filename = formatDateEpisodeFilename(title, year, airDate, episodeTitle, extension);
    return path_1.default.join(seasonFolder, filename);
}
