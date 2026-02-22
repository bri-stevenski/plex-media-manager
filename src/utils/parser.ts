/**
 * Filename parser for extracting media metadata from filenames.
 *
 * This module provides functions to parse TV show and movie filenames,
 * extracting information like series names, season/episode numbers, years,
 * and episode titles for use in media processing and Plex naming.
 */

import path from 'path';
import {
  CONTENT_TYPE_MOVIES,
  CONTENT_TYPE_TV,
  DATE_REGEXES,
  QUALITY_FORMATS_REGEX,
  SEASON_EPISODE_REGEX,
  YEAR_REGEX,
} from './constants';

/**
 * Normalize text by replacing common separators and removing extra whitespace.
 */
function normalizeText(text: string): string {
  let normalized = text.replace(/[._+-]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim();
}

/**
 * Remove characters that are problematic in filenames.
 */
function sanitizeFilename(text: string): string {
  const invalidChars = /[<>:"/\\|?*]/g;
  return text.replace(invalidChars, '').trim();
}

/**
 * Extract season and episode numbers from a TV show filename.
 */
function parseTvFilename(filename: string): [number | null, number | null] {
  const match = SEASON_EPISODE_REGEX.exec(filename);
  if (match) {
    if (match[1] && match[2]) {
      // 6X10 pattern
      return [parseInt(match[1]), parseInt(match[2])];
    } else if (match[4] && match[5]) {
      // S04E19 pattern
      return [parseInt(match[4]), parseInt(match[5])];
    }
  }
  return [null, null];
}

/**
 * Extract date from filename for date-based TV shows.
 */
function parseDateInFilename(filename: string): [string | null, number | null] {
  for (const rx of DATE_REGEXES) {
    const match = rx.exec(filename);
    if (match) {
      const first = match[1];
      const second = match[2];
      const third = match[3];

      if (!first || !second || !third) {
        continue;
      }

      let year: string;
      let month: string;
      let day: string;

      // YYYY-MM-DD
      if (first.length === 4) {
        year = first;
        month = second;
        day = third;
      } else {
        // DD-MM-YYYY
        day = first;
        month = second;
        year = third;
      }

      return [`${year}-${month}-${day}`, parseInt(year)];
    }
  }
  return [null, null];
}

/**
 * Infer season number from path segments.
 */
function parseSeasonFromPath(filepath: string): number | null {
  const parts = path.normalize(filepath).split(path.sep);
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    const seasonMatch = /^Season\s+(\d{1,2})$/i.exec(part);
    if (seasonMatch && seasonMatch[1]) {
      return parseInt(seasonMatch[1]);
    }
    if (/^Specials$/i.test(part)) {
      return 0;
    }
  }
  return null;
}

/**
 * Infer show directory name from file parent folders.
 */
function inferShowDirectoryFromPath(filepath: string): string {
  const parent = path.basename(path.dirname(filepath));
  if (/^Season\s+\d{1,2}$/i.test(parent) || /^Specials$/i.test(parent)) {
    return path.basename(path.dirname(path.dirname(filepath)));
  }
  return parent;
}

/**
 * Parse movie title/year from parent folder when available.
 * Example: "Hamilton (2020)" or "Hamilton (2020) {tmdb-556574}".
 */
function parseMovieDirectoryFromPath(filepath: string): [string, number | null] | null {
  const parentDir = path.basename(path.dirname(filepath));

  let cleaned = parentDir.replace(/\s*\{tmdb-\d+\}\s*/gi, ' ').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const match = /^(.*?)\s*\((\d{4})\)/.exec(cleaned);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  const title = normalizeText(match[1]);
  if (!title) {
    return null;
  }

  return [title, parseInt(match[2])];
}

/**
 * Normalize for loose title comparison.
 */
function normalizeForComparison(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extract the last 4-digit year between 1900-2099 from a filename stem.
 */
function extractYearFromStem(stem: string): number | null {
  const matches = stem.matchAll(new RegExp(YEAR_REGEX.source, 'g'));
  let lastYear: number | null = null;
  for (const match of matches) {
    const year = parseInt(match[0]);
    if (year >= 1900 && year <= 2099) {
      lastYear = year;
    }
  }
  return lastYear;
}

/**
 * Extract human-readable title and year from a noisy filename stem.
 */
function guessTitleAndYearFromStem(stem: string): [string, number | null] {
  const s = normalizeText(stem);

  // First try parentheses style: Title (2024)
  let year: number | null = null;
  let titlePart = s;
  const parenthesesMatch = /\((19|20)\d{2}\)/.exec(s);
  if (parenthesesMatch) {
    year = parseInt(parenthesesMatch[0].slice(1, -1));
    titlePart = s.slice(0, parenthesesMatch.index).trim();
  } else {
    // Otherwise pick the last 4-digit year token
    year = extractYearFromStem(s);
    if (year) {
      const yearMatch = Array.from(s.matchAll(new RegExp(YEAR_REGEX.source, 'g'))).find(
        (m) => parseInt(m[0]) === year,
      );
      if (yearMatch) {
        titlePart = s.slice(0, yearMatch.index).trim();
      }
    }
  }

  // Remove season/episode patterns
  titlePart = titlePart.replace(SEASON_EPISODE_REGEX, '');

  // Remove quality/format tags
  titlePart = titlePart.replace(QUALITY_FORMATS_REGEX, '');

  // Remove common noisy patterns
  const noisyPatterns = [
    /\b(S\d{1,2}E\d{1,2})\b/gi,
    /\b(1080p|720p|480p|2160p|4k)\b/gi,
    /\b(WEB[-\s]?DL|BluRay|DVDRip)\b/gi,
    /\b(x264|x265|h\.264|h\.265)\b/gi,
    /\b(DDP?\d*\.?\d*|AAC|AC3)\b/gi,
    /\b(AMZN|NF|HBO|HULU)\b/gi,
    /\b(NTb|ELiTE)\b/gi,
    /\[[^\]]+\]/g,
    /\{[^}]+\}/g,
    /\[.*?\]/g,
    /\b(IN[-\s]?DEPTH|FEATURETTES?|BONUS(?:\s+FEATURES?)?|INTERVIEWS?|BEHIND\s+THE\s+SCENES)\b/gi,
  ];

  for (const pattern of noisyPatterns) {
    titlePart = titlePart.replace(pattern, '');
  }

  // Strip distributor/promo prefixes like "The Undefeated Presents ..."
  titlePart = titlePart.replace(/^.*?\bPRESENTS?\b\s+/i, '');

  titlePart = titlePart
    .replace(/\s+/g, ' ')
    .replace(/\s*[-_()]\s*/g, ' ')
    .trim();

  // Convert to title case if all caps
  if (titlePart === titlePart.toUpperCase()) {
    titlePart = titlePart
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  return [titlePart.trim(), year];
}

/**
 * Extract episode title from a TV show filename stem.
 */
function extractEpisodeTitleFromFilename(stem: string): string | null {
  // OPTIMIZATION: Strip quality formats first before any extraction
  let cleaned = stem;

  // Remove common quality/release formats first
  const qualityPatterns = [
    /\s*\[?(?:1080p|720p|480p|2160p|4k|UHD)\]?\s*/gi,
    /\s*\[?(?:WEB[-\s]?DL|WEB|BluRay|BLURAY|BRRip|DVDRip|HDRip)\]?\s*/gi,
    /\s*\[?(?:x264|x265|h\.?264|h\.?265)\]?\s*/gi,
    /\s*\[?(?:AMZN|NF|NETFLIX|HBO|HULU|DSNP)\]?\s*/gi,
    /\s*\[?(?:AAC|AC3|DDP?\d*\.?\d*)\]?\s*/gi,
    /\s*\[?(?:NTb|ELiTE|GalaxyTV|UTR|FLUX|EVO)\]?\s*/gi,
  ];

  for (const pattern of qualityPatterns) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  // Clean up extra spaces from removal
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Try patterns on cleaned string first
  const patternsOriginal = [
    /[Ss]\d{1,2}[Ee]\d{1,2}\s*[-_\u2013\u2014]\s*(.+)$/,
    /.+\s*\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\s*[-_\u2013\u2014]\s*(.+)$/,
    /.+\s*\d{1,2}[-_.]\d{1,2}[-_.]\d{4}\s*[-_\u2013\u2014]\s*(.+)$/,
  ];

  for (const pattern of patternsOriginal) {
    const match = pattern.exec(cleaned);
    if (match) {
      let titleCandidate = match[1].trim().replace(/[-_]/g, '');

      // Remove parenthetical quality info
      titleCandidate = titleCandidate.replace(/\s*\([^)]*\)/g, '').trim();

      // Remove bracketed info
      titleCandidate = titleCandidate.replace(/\s*\[[^\]]*\]/g, '').trim();

      // Clean up excessive whitespace
      titleCandidate = titleCandidate.replace(/\s+/g, ' ').trim();

      if (
        titleCandidate &&
        titleCandidate.length > 0 &&
        !SEASON_EPISODE_REGEX.test(titleCandidate)
      ) {
        return sanitizeFilename(titleCandidate);
      }
    }
  }

  const s = normalizeText(cleaned);
  const patternsNormalized = [
    /[Ss]\d{1,2}[Ee]\d{1,2}\s+(.+)$/,
    /(.+)\s*[-_\u2013\u2014]\s*[Ss]\d{1,2}[Ee]\d{1,2}$/,
    /(.+)\s*[Ss]\d{1,2}[Ee]\d{1,2}$/,
  ];

  for (const pattern of patternsNormalized) {
    const match = pattern.exec(s);
    if (match) {
      let titleCandidate = match[1].trim();

      // Clean common prefixes/suffixes
      titleCandidate = titleCandidate.replace(/^(Part|Pt)\s*\d+/, '');
      titleCandidate = titleCandidate.replace(/\[.*?\]/g, '');

      if (
        titleCandidate &&
        !SEASON_EPISODE_REGEX.test(titleCandidate) &&
        !QUALITY_FORMATS_REGEX.test(titleCandidate)
      ) {
        return sanitizeFilename(titleCandidate);
      }
    }
  }

  return null;
}

export interface MediaInfo {
  content_type: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  date_str: string | null;
}

/**
 * Parse a media file and extract all relevant metadata.
 */
export function parseMediaFile(filepath: string): MediaInfo {
  const stem = path.basename(filepath, path.extname(filepath));
  const filename = path.basename(filepath);

  // Check if it's a TV show by looking for season/episode or date-based patterns
  const [seasonFromFilename, episodeFromFilename] = parseTvFilename(filename);
  const [dateStr, dateYear] = parseDateInFilename(filename);
  const isSeasonBasedTv = seasonFromFilename !== null && episodeFromFilename !== null;
  const isDateBasedTv = dateStr !== null;

  if (isSeasonBasedTv || isDateBasedTv) {
    // TV Show
    const pathParts = path.normalize(filepath).split(path.sep);
    let showDir: string | null = null;

    // Find the TV Shows directory and take the next part
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i]?.toLowerCase() === 'tv shows' && i + 1 < pathParts.length) {
        showDir = pathParts[i + 1];
        break;
      }
    }

    if (!showDir) {
      showDir = inferShowDirectoryFromPath(filepath);
    }

    // Extract year from show directory
    let yearFromDir: number | null = null;
    if (showDir) {
      const yearMatch = /\((\d{4})\)/.exec(showDir);
      if (yearMatch) {
        yearFromDir = parseInt(yearMatch[1]);
      }
    }

    // Clean up show directory name
    let showTitle = showDir || inferShowDirectoryFromPath(filepath);
    showTitle = showTitle.replace(/\s*\([^)]*\)/g, '').trim();
    showTitle = showTitle.replace(/\[.*?\]/g, '').trim();
    showTitle = showTitle.replace(/\s*\{[a-z0-9\-:]+\}/g, '').trim();

    // Remove noisy patterns
    const noisyPatterns = [
      /\bS\d{1,2}E\d{1,2}\b/gi,
      /\bSEASONS?\s+\d{1,2}(?:\s*[-/]\s*\d{1,2})?(?:\s+\d{1,2})*\b/gi,
      /\bS\d{1,2}(?:\s*[-/]\s*S?\d{1,2})?\b/gi,
      /\b(1080p|720p|480p|2160p|4k)\b/gi,
      /\b(WEB[-\s]?DL|BluRay|DVDRip|WEBRip)\b/gi,
      /\b(x264|x265|h264|h265)\b/gi,
      /\b(DDP?\d*\.?\d*|AAC|AC3)\b/gi,
      /\b(AMZN|NF|HBO|HULU)\b/gi,
      /\b(NTb|ELiTE|GalaxyTV)\b/gi,
      /\b(REPACK|PROPER|RERIP|READNFO|INTERNAL)\b/gi,
      /\b(EXTRAS?|BONUS)\b/gi,
      /\[[^\]]+\]/g,
      /\{[^}]+\}/g,
      /\b(COMPLETE|Series)\b/gi,
      /\b(19|20)\d{2}\b/g,
    ];

    for (const pattern of noisyPatterns) {
      showTitle = showTitle.replace(pattern, ' ');
    }

    showTitle = showTitle.replace(/[._+-]/g, ' ');
    showTitle = showTitle.replace(/\s+/g, ' ').trim();

    const episodeTitle = extractEpisodeTitleFromFilename(stem);

    let season = seasonFromFilename;
    if (season === null && isDateBasedTv) {
      season = parseSeasonFromPath(filepath);
    }

    const episode = episodeFromFilename;

    let year = yearFromDir;
    if (!year && dateYear) {
      year = dateYear;
    }

    return {
      content_type: CONTENT_TYPE_TV,
      title: showTitle,
      year,
      season,
      episode,
      episode_title: episodeTitle,
      date_str: dateStr,
    };
  } else {
    // Movie
    const [titleFromStem, yearFromStem] = guessTitleAndYearFromStem(stem);
    const movieDirInfo = parseMovieDirectoryFromPath(filepath);

    let title = titleFromStem;
    let year = yearFromStem;

    if (movieDirInfo) {
      const [dirTitle, dirYear] = movieDirInfo;
      const normalizedStemTitle = normalizeForComparison(titleFromStem);
      const normalizedDirTitle = normalizeForComparison(dirTitle);

      const yearsCompatible = !yearFromStem || !dirYear || yearFromStem === dirYear;
      const stemContainsFolderTitle =
        normalizedDirTitle.length >= 4 && normalizedStemTitle.includes(normalizedDirTitle);

      // Prefer structured folder titles when filename appears to add noisy descriptors.
      if (!titleFromStem || (yearsCompatible && stemContainsFolderTitle)) {
        title = dirTitle;
        year = dirYear ?? yearFromStem;
      } else if (!year && dirYear) {
        year = dirYear;
      }
    }

    return {
      content_type: CONTENT_TYPE_MOVIES,
      title,
      year,
      season: null,
      episode: null,
      episode_title: null,
      date_str: null,
    };
  }
}
