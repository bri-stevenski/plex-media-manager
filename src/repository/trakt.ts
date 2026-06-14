/**
 * Trakt.tv API client — pull watchlist and check what's already in the library.
 *
 * Auth: Trakt uses OAuth2 for user data, but the watchlist endpoint only
 * needs a Client-ID header for public lists. For private lists you need a
 * user access token (TRAKT_ACCESS_TOKEN). We support both.
 *
 * Docs: https://trakt.docs.apiary.io/
 */

import axios, { AxiosInstance } from 'axios';
import { getLogger } from '../config/logger.js';

const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID ?? '';
const TRAKT_ACCESS_TOKEN = process.env.TRAKT_ACCESS_TOKEN ?? '';
const TRAKT_BASE_URL = 'https://api.trakt.tv';

export type WatchlistItemType = 'movie' | 'show';

export interface WatchlistMovie {
  type: 'movie';
  title: string;
  year: number | null;
  traktId: number;
  tmdbId: number | null;
  imdbId: string | null;
}

export interface WatchlistShow {
  type: 'show';
  title: string;
  year: number | null;
  traktId: number;
  tmdbId: number | null;
  imdbId: string | null;
}

export type WatchlistItem = WatchlistMovie | WatchlistShow;

export interface WatchlistReport {
  movies: WatchlistMovie[];
  shows: WatchlistShow[];
  /** Items from the watchlist already present in the library */
  alreadyOwned: WatchlistItem[];
  /** Items not yet in the library */
  wanted: WatchlistItem[];
}

export class TraktClient {
  private http: AxiosInstance;

  constructor(clientId: string = TRAKT_CLIENT_ID, accessToken: string = TRAKT_ACCESS_TOKEN) {
    const headers: Record<string, string> = {
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    this.http = axios.create({
      baseURL: TRAKT_BASE_URL,
      headers,
      timeout: 15_000,
    });
  }

  /** Fetch the authenticated user's movie + show watchlist. */
  async getWatchlist(): Promise<WatchlistItem[]> {
    const [movies, shows] = await Promise.all([
      this.http.get<any[]>('/sync/watchlist/movies').then((r) => r.data),
      this.http.get<any[]>('/sync/watchlist/shows').then((r) => r.data),
    ]);

    return [
      ...movies.map((entry): WatchlistMovie => ({
        type: 'movie',
        title: entry.movie?.title ?? '',
        year: entry.movie?.year ?? null,
        traktId: entry.movie?.ids?.trakt ?? 0,
        tmdbId: entry.movie?.ids?.tmdb ?? null,
        imdbId: entry.movie?.ids?.imdb ?? null,
      })),
      ...shows.map((entry): WatchlistShow => ({
        type: 'show',
        title: entry.show?.title ?? '',
        year: entry.show?.year ?? null,
        traktId: entry.show?.ids?.trakt ?? 0,
        tmdbId: entry.show?.ids?.tmdb ?? null,
        imdbId: entry.show?.ids?.imdb ?? null,
      })),
    ];
  }

  /** Fetch a specific user's public watchlist (no auth required). */
  async getUserWatchlist(username: string): Promise<WatchlistItem[]> {
    const [movies, shows] = await Promise.all([
      this.http.get<any[]>(`/users/${username}/watchlist/movies`).then((r) => r.data),
      this.http.get<any[]>(`/users/${username}/watchlist/shows`).then((r) => r.data),
    ]);

    return [
      ...movies.map((entry): WatchlistMovie => ({
        type: 'movie',
        title: entry.movie?.title ?? '',
        year: entry.movie?.year ?? null,
        traktId: entry.movie?.ids?.trakt ?? 0,
        tmdbId: entry.movie?.ids?.tmdb ?? null,
        imdbId: entry.movie?.ids?.imdb ?? null,
      })),
      ...shows.map((entry): WatchlistShow => ({
        type: 'show',
        title: entry.show?.title ?? '',
        year: entry.show?.year ?? null,
        traktId: entry.show?.ids?.trakt ?? 0,
        tmdbId: entry.show?.ids?.tmdb ?? null,
        imdbId: entry.show?.ids?.imdb ?? null,
      })),
    ];
  }

  /** Search Trakt for a movie or show by title. */
  async search(query: string, type: 'movie' | 'show' = 'movie'): Promise<WatchlistItem[]> {
    const res = await this.http.get<any[]>(`/search/${type}`, {
      params: { query, limit: 5 },
    });
    return res.data.map((entry): WatchlistItem => {
      const media = entry[type];
      return {
        type,
        title: media?.title ?? '',
        year: media?.year ?? null,
        traktId: media?.ids?.trakt ?? 0,
        tmdbId: media?.ids?.tmdb ?? null,
        imdbId: media?.ids?.imdb ?? null,
      } as WatchlistItem;
    });
  }
}

export function isTraktConfigured(): boolean {
  return TRAKT_CLIENT_ID.length > 0;
}
