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
} from '../config';
import type { MediaInfo } from '../types';

/**
 * Extract a TMDb ID embedded in a filename or folder name.
 * Handles both {tmdb-XXXXX} (Plex standard) and (tmdb-XXXXX) (common variant).
 */
function extractTmdbId(text: string): number | null {
  const match = /[{(]tmdb-(\d+)[})]/i.exec(text);
  if (!match || !match[1]) return null;
  const id = parseInt(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

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
  // Strip embedded TMDb ID tags before any processing so they don't pollute the title
  const strippedStem = stem.replace(/[({]tmdb-\d+[})]/gi, '').trim();
  const s = normalizeText(strippedStem);

  // First try parentheses style: Title (2024)
  let year: number | null = null;
  let titlePart = s;
  const parenthesesMatch = /\((19|20)\d{2}\)/.exec(s);
  if (parenthesesMatch) {
    year = parseInt(parenthesesMatch[0].slice(1, -1));
    titlePart = s.slice(0, parenthesesMatch.index).trim();
  } else {
    // Strip filesize tokens (e.g. "1900mb", "8gb") before year extraction to avoid false matches
    const sNoFilesizes = s
      .replace(/\b\d+\s*[kmg]b\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    year = extractYearFromStem(sNoFilesizes);
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
 * Remove quality and release format tags from a filename stem.
 */
const QUALITY_TAG_PATTERNS = [
  /\s*\[?(?:1080p|720p|480p|2160p|4k|UHD)\]?\s*/gi,
  /\s*\[?(?:WEB[-\s]?DL|WEB|BluRay|BLURAY|BRRip|DVDRip|HDRip)\]?\s*/gi,
  /\s*\[?(?:x264|x265|h\.?264|h\.?265)\]?\s*/gi,
  /\s*\[?(?:AMZN|NF|NETFLIX|HBO|HULU|DSNP)\]?\s*/gi,
  /\s*\[?(?:AAC|AC3|DDP?\d*\.?\d*)\]?\s*/gi,
  /\s*\[?(?:NTb|ELiTE|GalaxyTV|UTR|FLUX|EVO)\]?\s*/gi,
];

function cleanStemFromQualityTags(stem: string): string {
  let cleaned = stem;
  for (const pattern of QUALITY_TAG_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Try to match episode title using original (cleaned) stem.
 */
function matchEpisodeTitleOriginal(cleaned: string): string | null {
  const patterns = [
    /[Ss]\d{1,2}[Ee]\d{1,2}\s*[-_\u2013\u2014]\s*(.+)$/,
    /.+\s*\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\s*[-_\u2013\u2014]\s*(.+)$/,
    /.+\s*\d{1,2}[-_.]\d{1,2}[-_.]\d{4}\s*[-_\u2013\u2014]\s*(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(cleaned);
    if (match) {
      let titleCandidate = match[1].trim().replace(/[-_]/g, '');

      // Remove parenthetical and bracketed info
      titleCandidate = titleCandidate.replace(/\s*\([^)]*\)/g, '').trim();
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
  return null;
}

/**
 * Try to match episode title using normalized stem.
 */
function matchEpisodeTitleNormalized(cleaned: string): string | null {
  const s = normalizeText(cleaned);
  const patterns = [
    /[Ss]\d{1,2}[Ee]\d{1,2}\s+(.+)$/,
    /(.+)\s*[-_\u2013\u2014]\s*[Ss]\d{1,2}[Ee]\d{1,2}$/,
    /(.+)\s*[Ss]\d{1,2}[Ee]\d{1,2}$/,
  ];

  for (const pattern of patterns) {
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

/**
 * Extract episode title from a TV show filename stem.
 */
function extractEpisodeTitleFromFilename(stem: string): string | null {
  const cleaned = cleanStemFromQualityTags(stem);

  const originalMatch = matchEpisodeTitleOriginal(cleaned);
  if (originalMatch) {
    return originalMatch;
  }

  return matchEpisodeTitleNormalized(cleaned);
}

/**
 * Clean up show directory name by removing noisy patterns.
 */
function cleanShowTitle(showDir: string): string {
  let title = showDir.replace(/\s*\([^)]*\)/g, '').trim();
  title = title.replace(/\[.*?\]/g, '').trim();
  title = title.replace(/\s*\{[a-z0-9\-:]+\}/g, '').trim();

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
    title = title.replace(pattern, ' ');
  }

  title = title.replace(/[._+-]/g, ' ');
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a TV media file and extract metadata.
 */
/**
 * Derive a show title from a release-style filename stem (e.g.
 * "The.Office.US.S03E10.Christmas.Party.1080p") by taking everything before the
 * season/episode or air-date token and cleaning it. Used when a TV file has no
 * show folder to read the name from, so a flat file under TV Shows/ no longer
 * mangles the title with the episode name and extension.
 */
function deriveShowTitleFromStem(stem: string): string {
  let head = stem;
  const seMatch = SEASON_EPISODE_REGEX.exec(stem);
  if (seMatch && seMatch.index > 0) {
    head = stem.slice(0, seMatch.index);
  } else {
    for (const rx of DATE_REGEXES) {
      const match = rx.exec(stem);
      if (match && match.index > 0) {
        head = stem.slice(0, match.index);
        break;
      }
    }
  }
  return cleanShowTitle(head) || cleanShowTitle(stem);
}

function parseTvMedia(
  filepath: string,
  stem: string,
  seasonFromFilename: number | null,
  episodeFromFilename: number | null,
  dateStr: string | null,
  dateYear: number | null,
): MediaInfo {
  const pathParts = path.normalize(filepath).split(path.sep);
  const fileIndex = pathParts.length - 1;
  let showDir: string | null = null;

  // A real show folder lives directly under "TV Shows/" — but only when that
  // next segment is a subdirectory, not the media file sitting in TV Shows/.
  for (let i = 0; i < pathParts.length; i++) {
    if (pathParts[i]?.toLowerCase() === 'tv shows' && i + 1 < fileIndex) {
      showDir = pathParts[i + 1];
      break;
    }
  }

  // Otherwise a show folder is recognisable from the parent: a Season/Specials
  // parent (show is the grandparent) or a parent carrying a "(YYYY)" tag.
  if (!showDir) {
    const parent = path.basename(path.dirname(filepath));
    const parentIsShowFolder =
      /^Season\s+\d{1,2}$/i.test(parent) || /^Specials$/i.test(parent) || /\(\d{4}\)/.test(parent);
    if (parentIsShowFolder) {
      showDir = inferShowDirectoryFromPath(filepath);
    }
  }

  let yearFromDir: number | null = null;
  if (showDir) {
    const yearMatch = /\((\d{4})\)/.exec(showDir);
    if (yearMatch) {
      yearFromDir = parseInt(yearMatch[1]);
    }
  }

  // With a real show folder, clean its name; otherwise (flat/loose file) derive
  // the title from the filename rather than mangling a container directory.
  const showTitle = showDir ? cleanShowTitle(showDir) : deriveShowTitleFromStem(stem);
  const episodeTitle = extractEpisodeTitleFromFilename(stem);

  let season = seasonFromFilename;
  if (season === null && dateStr !== null) {
    season = parseSeasonFromPath(filepath);
  }

  let year = yearFromDir;
  if (!year && dateYear) {
    year = dateYear;
  }

  return {
    content_type: CONTENT_TYPE_TV,
    title: showTitle,
    year,
    season,
    episode: episodeFromFilename,
    episode_title: episodeTitle,
    date_str: dateStr,
    tmdb_id: null,
  };
}

/**
 * Parse a movie media file and extract metadata.
 */
function parseMovieMedia(filepath: string, stem: string): MediaInfo {
  const tmdb_id = extractTmdbId(stem) ?? extractTmdbId(path.dirname(filepath));
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
    tmdb_id: tmdb_id ?? null,
  };
}

/**
 * Extract season number from a release-style folder name (e.g. "Show.S04.Release").
 * Only matches S followed by digits when surrounded by separator characters or at boundaries,
 * so "Sunny" or "Sinister" don't trigger false positives.
 */
function extractSeasonFromReleaseFolder(folderName: string): number | null {
  const match = /(?:^|[._\s-])S(\d{1,2})(?=[._\s-]|$)/i.exec(folderName);
  if (!match || !match[1]) return null;
  const season = parseInt(match[1]);
  return season >= 1 && season <= 99 ? season : null;
}

/**
 * Extract the show title from a release-style folder by taking everything before the
 * season indicator. E.g. "Its.Always.Sunny.in.Philadelphia.S04.REPACK" → "Its Always Sunny in Philadelphia".
 */
function extractTitleFromReleaseFolder(folderName: string): string {
  const match = /(?:^|[._\s-])S\d{1,2}(?=[._\s-]|$)/i.exec(folderName);
  if (!match || match.index === 0) return '';
  return cleanShowTitle(folderName.slice(0, match.index));
}

/**
 * When a file sits in a release-season folder (e.g. Show.S04.Release/) and uses a compact
 * numbering scheme like "show401.avi" (season 4, ep 01), derive the episode by stripping the
 * leading season digits from the numeric suffix in the stem.
 */
function extractEpisodeFromSeasonFolderFile(stem: string, season: number): number | null {
  const seasonStr = String(season);
  // Also try zero-padded prefix so XXYY compact codes like "0101" (S01E01) are handled
  // when the parent folder is "s01" and season resolves to 1.
  const seasonStrPadded = seasonStr.padStart(2, '0');
  const prefixes = seasonStr === seasonStrPadded ? [seasonStr] : [seasonStr, seasonStrPadded];
  for (const match of stem.matchAll(/\d+/g)) {
    const num = match[0];
    for (const prefix of prefixes) {
      if (num.startsWith(prefix) && num.length > prefix.length) {
        const epStr = num.slice(prefix.length);
        if (epStr.length >= 2 && epStr.length <= 3) {
          const ep = parseInt(epStr);
          if (ep >= 0 && ep <= 999) return ep;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a media file and extract all relevant metadata.
 */
export function parseMediaFile(filepath: string): MediaInfo {
  const stem = path.basename(filepath, path.extname(filepath));
  const filename = path.basename(filepath);

  // Only treat the file as being in a Movies library if a path segment is exactly "Movies"
  // or "Movie" — prevents false positives like "Pokemon ... + Movie (1998)".
  const isInMoviesFolder = path.normalize(filepath).split(path.sep).some((seg) =>
    /^movies?$/i.test(seg),
  );
  const [seasonFromFilename, episodeFromFilename] = parseTvFilename(filename);
  const [dateStr, dateYear] = parseDateInFilename(filename);
  const isSeasonBasedTv = seasonFromFilename !== null && episodeFromFilename !== null;
  const isDateBasedTv = dateStr !== null;

  if ((isSeasonBasedTv || isDateBasedTv) && !isInMoviesFolder) {
    return parseTvMedia(filepath, stem, seasonFromFilename, episodeFromFilename, dateStr, dateYear);
  }

  // Fallback: detect release-style season folders (e.g. ShowName.S04.DVDrip/)
  // whose individual episode files carry no SxxExx token of their own (e.g. clue-sun401.avi).
  if (!isInMoviesFolder) {
    const parentDir = path.basename(path.dirname(filepath));
    const releaseSeason = extractSeasonFromReleaseFolder(parentDir);
    if (releaseSeason !== null) {
      const folderTitle = extractTitleFromReleaseFolder(parentDir);
      // When parent is a bare "sNN" folder (no title before the season marker), use the
      // grandparent folder name as the show title instead of deriving from the stem —
      // otherwise episode numbers embedded in the stem (XXYY format) pollute the title.
      const grandparentTitle = folderTitle
        ? ''
        : cleanShowTitle(path.basename(path.dirname(path.dirname(filepath))));
      return {
        content_type: CONTENT_TYPE_TV,
        title: folderTitle || grandparentTitle || deriveShowTitleFromStem(stem),
        year: null,
        season: releaseSeason,
        episode: extractEpisodeFromSeasonFolderFile(stem, releaseSeason),
        episode_title: extractEpisodeTitleFromFilename(stem),
        date_str: null,
        tmdb_id: null,
      };
    }
  }

  return parseMovieMedia(filepath, stem);
}
