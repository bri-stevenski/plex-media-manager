import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { getLogger } from '../config/logger.js';

const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY ?? '';
const OS_USERNAME = process.env.OPENSUBTITLES_USERNAME ?? '';
const OS_PASSWORD = process.env.OPENSUBTITLES_PASSWORD ?? '';
const OS_BASE_URL = 'https://api.opensubtitles.com/api/v1';

export interface SubtitleResult {
  id: string;
  language: string;
  releaseName: string;
  downloadCount: number;
  fileId: number;
}

export class OpenSubtitlesClient {
  private http: AxiosInstance;
  private token: string | null = null;

  constructor(apiKey: string = OS_API_KEY) {
    this.http = axios.create({
      baseURL: OS_BASE_URL,
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'plex-media-manager v3',
      },
      timeout: 15_000,
    });
  }

  async login(username: string = OS_USERNAME, password: string = OS_PASSWORD): Promise<void> {
    if (this.token) return;
    const res = await this.http.post('/login', { username, password });
    this.token = res.data.token;
    this.http.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    getLogger().debug('OpenSubtitles login successful');
  }

  async logout(): Promise<void> {
    if (!this.token) return;
    await this.http.delete('/logout').catch(() => {});
    this.token = null;
    delete this.http.defaults.headers.common['Authorization'];
  }

  async searchByImdbId(
    imdbId: string,
    languages: string[] = ['en'],
    type: 'movie' | 'episode' = 'movie',
  ): Promise<SubtitleResult[]> {
    const res = await this.http.get('/subtitles', {
      params: {
        imdb_id: imdbId.replace(/^tt/, ''),
        languages: languages.join(','),
        type,
        order_by: 'download_count',
        order_direction: 'desc',
      },
    });
    return this.parseResults(res.data?.data ?? []);
  }

  async searchByTmdbId(
    tmdbId: number,
    languages: string[] = ['en'],
    type: 'movie' | 'episode' = 'movie',
    season?: number,
    episode?: number,
  ): Promise<SubtitleResult[]> {
    const params: Record<string, any> = {
      tmdb_id: tmdbId,
      languages: languages.join(','),
      type,
      order_by: 'download_count',
      order_direction: 'desc',
    };
    if (season != null) params.season_number = season;
    if (episode != null) params.episode_number = episode;

    const res = await this.http.get('/subtitles', { params });
    return this.parseResults(res.data?.data ?? []);
  }

  async getDownloadUrl(fileId: number): Promise<string> {
    const res = await this.http.post('/download', { file_id: fileId });
    return res.data.link;
  }

  /**
   * Download the best matching subtitle for a media file next to it on disk.
   * Returns the path written, or null if nothing was downloaded.
   */
  async downloadBestSubtitle(
    mediaFilePath: string,
    tmdbId: number,
    languages: string[] = ['en'],
    type: 'movie' | 'episode' = 'movie',
    season?: number,
    episode?: number,
  ): Promise<string | null> {
    await this.login();

    const results = await this.searchByTmdbId(tmdbId, languages, type, season, episode);
    if (results.length === 0) {
      getLogger().info('No subtitles found', { tmdbId, languages });
      return null;
    }

    const best = results[0];
    const downloadUrl = await this.getDownloadUrl(best.fileId);

    const subtitleResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    const ext = this.guessSubtitleExtension(best.releaseName);
    const langSuffix = best.language;
    const mediaBase = mediaFilePath.replace(/\.[^.]+$/, '');
    const outputPath = `${mediaBase}.${langSuffix}${ext}`;

    fs.writeFileSync(outputPath, subtitleResponse.data);
    getLogger().info('Subtitle downloaded', { outputPath, language: best.language, tmdbId });
    return outputPath;
  }

  private parseResults(raw: any[]): SubtitleResult[] {
    return raw.map((item) => ({
      id: item.id,
      language: item.attributes?.language ?? 'unknown',
      releaseName: item.attributes?.release ?? '',
      downloadCount: item.attributes?.download_count ?? 0,
      fileId: item.attributes?.files?.[0]?.file_id ?? 0,
    }));
  }

  private guessSubtitleExtension(releaseName: string): string {
    if (/\.ass$/i.test(releaseName)) return '.ass';
    if (/\.ssa$/i.test(releaseName)) return '.ssa';
    return '.srt';
  }
}

export function isOpenSubtitlesConfigured(): boolean {
  return OS_API_KEY.length > 0;
}
