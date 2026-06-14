import axios, { AxiosInstance } from 'axios';
import { getLogger } from '../config/logger.js';

const PLEX_URL = (process.env.PLEX_URL ?? '').replace(/\/$/, '');
const PLEX_TOKEN = process.env.PLEX_TOKEN ?? '';

export interface PlexLibrary {
  key: string;
  title: string;
  type: 'movie' | 'show' | 'artist';
  locations: string[];
}

export interface PlexSearchResult {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  guid: string;
}

export class PlexClient {
  private http: AxiosInstance;

  constructor(baseUrl: string = PLEX_URL, token: string = PLEX_TOKEN) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        'X-Plex-Token': token,
        Accept: 'application/json',
      },
      timeout: 15_000,
    });
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.http.get('/');
      return true;
    } catch {
      return false;
    }
  }

  async getLibraries(): Promise<PlexLibrary[]> {
    const res = await this.http.get('/library/sections');
    const dirs = res.data?.MediaContainer?.Directory ?? [];
    return dirs.map((d: Record<string, any>) => ({
      key: d.key,
      title: d.title,
      type: d.type,
      locations: (d.Location ?? []).map((l: Record<string, any>) => l.path),
    }));
  }

  async refreshLibrary(key: string): Promise<void> {
    await this.http.get(`/library/sections/${key}/refresh`);
    getLogger().info(`Plex library scan triggered`, { libraryKey: key });
  }

  async refreshAllLibraries(): Promise<void> {
    const libs = await this.getLibraries();
    for (const lib of libs) {
      await this.refreshLibrary(lib.key);
    }
  }

  /**
   * Refresh whichever libraries contain the given filesystem path.
   * Falls back to refreshing all if no match found.
   */
  async refreshLibraryForPath(filePath: string): Promise<void> {
    const libs = await this.getLibraries();
    const matched = libs.filter((lib) =>
      lib.locations.some((loc) => filePath.startsWith(loc)),
    );
    const targets = matched.length > 0 ? matched : libs;
    for (const lib of targets) {
      await this.refreshLibrary(lib.key);
    }
  }

  async searchLibrary(query: string, limit = 10): Promise<PlexSearchResult[]> {
    const res = await this.http.get('/search', {
      params: { query, limit },
    });
    const items = res.data?.MediaContainer?.Metadata ?? [];
    return items.map((m: Record<string, any>) => ({
      ratingKey: m.ratingKey,
      title: m.title,
      year: m.year,
      type: m.type,
      guid: m.guid,
    }));
  }

  /**
   * Pin a specific TMDb match on a Plex item so it won't re-identify.
   * Requires the ratingKey from a search result and the TMDb guid.
   */
  async lockMetadataMatch(ratingKey: string, tmdbId: number, type: 'movie' | 'show'): Promise<void> {
    const agentType = type === 'movie' ? 'movie' : 'show';
    const guid = `com.plexapp.agents.themoviedb://${tmdbId}?lang=en`;
    await this.http.put(`/library/metadata/${ratingKey}/match`, null, {
      params: { guid, name: agentType },
    });
    getLogger().info(`Pinned TMDb metadata`, { ratingKey, tmdbId });
  }

  /**
   * Fix metadata on a Plex item (re-analyze + lock).
   */
  async fixMetadata(ratingKey: string): Promise<void> {
    await this.http.put(`/library/metadata/${ratingKey}/fix`);
  }
}

export function isPlexConfigured(): boolean {
  return PLEX_URL.length > 0 && PLEX_TOKEN.length > 0;
}
