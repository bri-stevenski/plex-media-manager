/**
 * Watchlist sync service.
 *
 * Compares a Trakt watchlist against what's already in the local library
 * and produces a "wanted" list — things you haven't grabbed yet.
 *
 * The library check is purely filename-based (no Plex API needed) so it
 * works even when Plex is offline.
 */

import fs from 'fs';
import path from 'path';
import { TraktClient, WatchlistItem, isTraktConfigured } from '../repository/trakt.js';
import { getLogger } from '../config/logger.js';

export interface WatchlistSyncResult {
  total: number;
  alreadyOwned: WatchlistItem[];
  wanted: WatchlistItem[];
}

/**
 * Build a set of normalized titles+years present in the library so we can
 * do fast membership checks. Reads folder names — no file system deep scan.
 */
function buildLibraryIndex(completedDir: string): Set<string> {
  const index = new Set<string>();
  const addDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Folder names like "The Matrix (1999) {tmdb-603}" or "Breaking Bad (2008) {tmdb-1396}"
      // Normalize to "the matrix 1999" for fuzzy matching
      index.add(normalizeTitle(entry.name));
    }
  };

  // Check both Movies/ and TV Shows/ sub-dirs
  addDir(path.join(completedDir, 'Movies'));
  addDir(path.join(completedDir, 'TV Shows'));
  // Also check the completed root itself in case of flat layout
  addDir(completedDir);

  return index;
}

function normalizeTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/\{[^}]+\}/g, '') // strip {tmdb-xxx}
    .replace(/[^\w\s]/g, ' ')  // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

function libraryKey(title: string, year: number | null): string {
  const base = title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return year ? `${base} ${year}` : base;
}

function isInLibrary(item: WatchlistItem, index: Set<string>): boolean {
  const key = libraryKey(item.title, item.year);
  if (index.has(key)) return true;

  // Also try without year (some folders omit it for older content)
  const keyNoYear = libraryKey(item.title, null);
  for (const entry of index) {
    if (entry.startsWith(keyNoYear)) return true;
  }
  return false;
}

/**
 * Compare the Trakt watchlist against the local library.
 * Returns items split into alreadyOwned vs wanted.
 */
export async function syncWatchlist(
  completedDir: string,
  username?: string,
): Promise<WatchlistSyncResult> {
  const logger = getLogger();

  if (!isTraktConfigured()) {
    logger.warning('Trakt not configured — set TRAKT_CLIENT_ID (and optionally TRAKT_ACCESS_TOKEN)');
    return { total: 0, alreadyOwned: [], wanted: [] };
  }

  const client = new TraktClient();
  const items = username
    ? await client.getUserWatchlist(username)
    : await client.getWatchlist();

  logger.info('Trakt watchlist fetched', { count: items.length, username: username ?? 'self' });

  const index = buildLibraryIndex(completedDir);
  const alreadyOwned: WatchlistItem[] = [];
  const wanted: WatchlistItem[] = [];

  for (const item of items) {
    if (isInLibrary(item, index)) {
      alreadyOwned.push(item);
    } else {
      wanted.push(item);
    }
  }

  logger.info('Watchlist sync complete', {
    total: items.length,
    owned: alreadyOwned.length,
    wanted: wanted.length,
  });

  return { total: items.length, alreadyOwned, wanted };
}
