/**
 * Missing episode detector.
 *
 * Compares what's actually on disk in your TV library against what TMDb
 * says exists (only aired episodes, up to today), and reports gaps.
 */

import fs from 'fs';
import path from 'path';
import { TMDbClient } from '../repository/tmdb.js';
import { getLogger } from '../config/logger.js';

export interface MissingEpisode {
  showTitle: string;
  tmdbId: number;
  season: number;
  episode: number;
  episodeTitle: string;
  airDate: string;
}

export interface ShowGapReport {
  showTitle: string;
  tmdbId: number;
  totalAired: number;
  onDisk: number;
  missing: MissingEpisode[];
}

interface DiskEpisode {
  season: number;
  episode: number;
}

// Matches filenames like "Show Name (2020) - s01e03 - Episode Title.mkv"
const SXEX_RE = /[sS](\d{1,2})[eE](\d{1,2})/;

function parseDiskEpisodes(showDir: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const m = SXEX_RE.exec(entry.name);
        if (m) {
          found.add(`${parseInt(m[1], 10)}x${parseInt(m[2], 10)}`);
        }
      }
    }
  };
  walk(showDir);
  return found;
}

function extractTmdbId(dirName: string): number | null {
  const m = /\{tmdb-(\d+)\}/.exec(dirName);
  return m ? parseInt(m[1], 10) : null;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Scan a single show directory and return which episodes are missing vs TMDb.
 */
export async function findMissingEpisodes(
  showDir: string,
  tmdb: TMDbClient,
): Promise<ShowGapReport | null> {
  const logger = getLogger();
  const dirName = path.basename(showDir);
  const tmdbId = extractTmdbId(dirName);

  if (!tmdbId) {
    logger.debug('Skipping show dir — no TMDb ID in name', { dirName });
    return null;
  }

  const diskEpisodes = parseDiskEpisodes(showDir);

  let showDetails: Record<string, any>;
  try {
    showDetails = await tmdb.getTvShowDetails(tmdbId);
  } catch (err: any) {
    logger.warning('Failed to fetch show details from TMDb', { tmdbId, error: err.message });
    return null;
  }

  const showTitle: string = showDetails.name ?? dirName;
  const today = todayStr();
  const missing: MissingEpisode[] = [];
  let totalAired = 0;

  const seasons: any[] = (showDetails.seasons ?? []).filter(
    (s: any) => (s.season_number ?? 0) > 0,
  );

  for (const season of seasons) {
    const seasonNum: number = season.season_number;
    let seasonData: Record<string, any>;
    try {
      seasonData = await tmdb.getTvSeasonDetails(tmdbId, seasonNum);
    } catch {
      continue;
    }

    const episodes: any[] = seasonData.episodes ?? [];
    for (const ep of episodes) {
      const airDate: string = ep.air_date ?? '';
      if (!airDate || airDate > today) continue; // not aired yet

      totalAired++;
      const key = `${seasonNum}x${ep.episode_number}`;
      if (!diskEpisodes.has(key)) {
        missing.push({
          showTitle,
          tmdbId,
          season: seasonNum,
          episode: ep.episode_number,
          episodeTitle: ep.name ?? '',
          airDate,
        });
      }
    }
  }

  return {
    showTitle,
    tmdbId,
    totalAired,
    onDisk: diskEpisodes.size,
    missing,
  };
}

/**
 * Scan an entire TV Shows library directory and return gap reports for every show.
 */
export async function scanLibraryForMissingEpisodes(
  tvLibraryDir: string,
  tmdb: TMDbClient,
  onlyShowsWithGaps = true,
): Promise<ShowGapReport[]> {
  const logger = getLogger();
  const reports: ShowGapReport[] = [];

  if (!fs.existsSync(tvLibraryDir)) {
    logger.warning('TV library directory does not exist', { tvLibraryDir });
    return reports;
  }

  const showDirs = fs
    .readdirSync(tvLibraryDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tvLibraryDir, e.name));

  for (const showDir of showDirs) {
    const report = await findMissingEpisodes(showDir, tmdb);
    if (!report) continue;
    if (onlyShowsWithGaps && report.missing.length === 0) continue;
    reports.push(report);
    logger.info('Gap report', {
      show: report.showTitle,
      totalAired: report.totalAired,
      onDisk: report.onDisk,
      missing: report.missing.length,
    });
  }

  return reports;
}
