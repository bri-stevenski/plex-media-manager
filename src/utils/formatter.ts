/**
 * Filename formatter for creating Plex-compliant media file names.
 *
 * This module provides functions to format media filenames according to
 * Plex naming conventions for both movies and TV shows.
 */

import path from 'path';
import { DateTime } from 'luxon';
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
 * Check if a TV show is still running based on TMDB data.
 */
function isShowStillRunning(tmdbData: Record<string, any>): boolean {
  const currentYear = DateTime.now().year;

  // Check if show is recent (within last 2 years)
  const firstAirDate = tmdbData.first_air_date;
  if (firstAirDate) {
    try {
      const airDate = DateTime.fromISO(firstAirDate);
      const yearsSinceAir = currentYear - airDate.year;
      if (yearsSinceAir <= 2) {
        return true;
      }
    } catch {
      return true;
    }
  }

  // Check if show has an end date
  const endDate = tmdbData.last_air_date;
  if (endDate) {
    try {
      const endDateTime = DateTime.fromISO(endDate);
      if (endDateTime > DateTime.now()) {
        return false;
      }
    } catch {
      // Invalid date format
    }
  }

  // If no explicit end date, assume it's still running
  return true;
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
  season: number,
  episode: number,
  episodeTitle: string | null,
  extension: string,
): string {
  const cleanTitle = seriesTitle.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);

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

  const filename = `${sanitized} - S${seasonStr}E${episodeStr} - ${cleanEpisodeTitle}${extension}`;
  logger.debug(`Formatted TV filename: ${filename}`);
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
function formatTvShowFolderName(
  title: string,
  year: number | null,
  tmdbId: number,
  isOngoing: boolean = false,
): string {
  const cleanTitle = title.trim().split(/\s+/).join(' ');
  const sanitized = sanitizeFilename(cleanTitle);

  let folderName: string;
  if (isOngoing) {
    folderName = `${sanitized} (${year}-) {tmdb-${tmdbId}}`;
  } else if (year) {
    folderName = `${sanitized} (${year}-) {tmdb-${tmdbId}}`;
  } else {
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
): string {
  const movieFolderName = formatMovieFolderName(title, year, tmdbId);
  const movieName = formatMovieName(title, year, tmdbId);
  return path.join(MEDIA_BASE_FOLDER, 'Movies', movieFolderName, `${movieName}${extension}`);
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
  tmdbData?: Record<string, any>,
): string {
  const isOngoing = tmdbData ? isShowStillRunning(tmdbData) : false;
  const showFolderName = formatTvShowFolderName(title, year, tmdbId, isOngoing);
  const showFolder = path.join(MEDIA_BASE_FOLDER, 'TV Shows', showFolderName);

  const seasonFolderName = formatSeasonFolderName(season);
  const seasonFolder = path.join(showFolder, seasonFolderName);

  const filename = formatEpisodeFilename(title, season, episode, episodeTitle, extension);

  return path.join(seasonFolder, filename);
}
