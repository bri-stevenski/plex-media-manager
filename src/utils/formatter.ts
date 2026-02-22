/**
 * Filename formatter for creating Plex-compliant media file names.
 *
 * This module provides functions to format media filenames according to
 * Plex naming conventions for both movies and TV shows.
 */

import path from 'path';
import { MEDIA_BASE_FOLDER } from './constants';
import { getLogger } from './logger';

const logger = getLogger();

/**
 * Remove characters that are problematic in filenames.
 */
function sanitizeFilename(text: string): string {
  const invalidChars = /[<>:"/\\|?*]/g;
  return text.replace(invalidChars, '').trim();
}

/**
 * Format a movie filename according to Plex conventions.
 */
function formatMovieName(title: string, year: number, tmdbId: number): string {
  const cleanTitle = title.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);
  const name = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
  logger.debug(`Formatted movie folder & file name: ${name}`);
  return name;
}

/**
 * Format a TV show episode filename according to Plex conventions.
 */
function formatEpisodeFilename(
  seriesTitle: string,
  seriesYear: number | null,
  season: number,
  episode: number,
  episodeTitle: string | null,
  extension: string,
): string {
  const cleanTitle = seriesTitle.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);
  const seriesLabel = seriesYear ? `${sanitized} (${seriesYear})` : sanitized;

  const seasonStr = String(season).padStart(2, '0');
  const episodeStr = String(episode).padStart(2, '0');

  let cleanEpisodeTitle: string;
  if (!episodeTitle || episodeTitle.trim().length === 0) {
    cleanEpisodeTitle = `Episode ${episodeStr}`;
    logger.warning(`Missing episode title, using fallback: ${cleanEpisodeTitle}`);
  } else {
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
function formatDateEpisodeFilename(
  seriesTitle: string,
  seriesYear: number | null,
  airDate: string,
  episodeTitle: string | null,
  extension: string,
): string {
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
function formatMovieFolderName(title: string, year: number, tmdbId: number): string {
  const cleanTitle = title.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);
  const folderName = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
  logger.debug(`Formatted movie folder name: ${folderName}`);
  return folderName;
}

/**
 * Format a TV show folder name according to Plex conventions.
 */
function formatTvShowFolderName(title: string, year: number | null, tmdbId: number): string {
  const cleanTitle = title.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);

  let folderName: string;
  if (year) {
    folderName = `${sanitized} (${year}) {tmdb-${tmdbId}}`;
  } else {
    // No year available
    folderName = `${sanitized} {tmdb-${tmdbId}}`;
  }

  logger.debug(`Formatted TV show folder name: ${folderName}`);
  return folderName;
}

/**
 * Format a season folder name according to Plex conventions.
 */
function formatSeasonFolderName(season: number): string {
  const seasonStr = String(season).padStart(2, '0');
  const folderName = `Season ${seasonStr}`;
  logger.debug(`Formatted season folder name: ${folderName}`);
  return folderName;
}

/**
 * Construct the full path for a movie file.
 */
export function constructMoviePath(
  title: string,
  year: number,
  tmdbId: number,
  extension: string,
  baseFolder: string = MEDIA_BASE_FOLDER,
): string {
  const movieFolderName = formatMovieFolderName(title, year, tmdbId);
  const movieName = formatMovieName(title, year, tmdbId);
  return path.join(baseFolder, 'Movies', movieFolderName, `${movieName}${extension}`);
}

/**
 * Construct the full path for a TV show episode file.
 */
export function constructTvShowPath(
  title: string,
  year: number | null,
  tmdbId: number,
  season: number,
  episode: number,
  episodeTitle: string | null,
  extension: string,
  baseFolder: string = MEDIA_BASE_FOLDER,
): string {
  const showFolderName = formatTvShowFolderName(title, year, tmdbId);
  const showFolder = path.join(baseFolder, 'TV Shows', showFolderName);

  const seasonFolderName = formatSeasonFolderName(season);
  const seasonFolder = path.join(showFolder, seasonFolderName);

  const filename = formatEpisodeFilename(title, year, season, episode, episodeTitle, extension);

  return path.join(seasonFolder, filename);
}

/**
 * Construct the full path for a date-based TV show episode file.
 */
export function constructTvShowDatePath(
  title: string,
  year: number | null,
  tmdbId: number,
  season: number,
  airDate: string,
  episodeTitle: string | null,
  extension: string,
  baseFolder: string = MEDIA_BASE_FOLDER,
): string {
  const showFolderName = formatTvShowFolderName(title, year, tmdbId);
  const showFolder = path.join(baseFolder, 'TV Shows', showFolderName);

  const seasonFolderName = formatSeasonFolderName(season);
  const seasonFolder = path.join(showFolder, seasonFolderName);

  const filename = formatDateEpisodeFilename(title, year, airDate, episodeTitle, extension);

  return path.join(seasonFolder, filename);
}
