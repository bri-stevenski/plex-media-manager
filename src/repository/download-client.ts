import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { getLogger } from '../config/logger.js';

const QB_URL = (process.env.QBITTORRENT_URL ?? '').replace(/\/$/, '');
const QB_USER = process.env.QBITTORRENT_USERNAME ?? 'admin';
const QB_PASS = process.env.QBITTORRENT_PASSWORD ?? '';

export interface TorrentInfo {
  hash: string;
  name: string;
  state: string;
  savePath: string;
  contentPath: string;
  size: number;
  progress: number;
  category: string;
  tags: string;
}

export class QBittorrentClient {
  private http: AxiosInstance;
  private loggedIn = false;

  constructor(baseUrl: string = QB_URL) {
    this.http = axios.create({
      baseURL: `${baseUrl}/api/v2`,
      timeout: 15_000,
      withCredentials: true,
    });
  }

  async login(username: string = QB_USER, password: string = QB_PASS): Promise<void> {
    if (this.loggedIn) return;
    const params = new URLSearchParams({ username, password });
    const res = await this.http.post('/auth/login', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (res.data !== 'Ok.') {
      throw new Error(`qBittorrent login failed: ${res.data}`);
    }
    this.loggedIn = true;
    getLogger().debug('qBittorrent login successful');
  }

  async getCompletedTorrents(category?: string): Promise<TorrentInfo[]> {
    await this.login();
    const params: Record<string, string> = { filter: 'completed' };
    if (category) params.category = category;

    const res = await this.http.get('/torrents/info', { params });
    return (res.data as any[]).map((t) => ({
      hash: t.hash,
      name: t.name,
      state: t.state,
      savePath: t.save_path,
      contentPath: t.content_path ?? path.join(t.save_path, t.name),
      size: t.size,
      progress: t.progress,
      category: t.category,
      tags: t.tags,
    }));
  }

  async deleteTorrent(hash: string, deleteFiles = false): Promise<void> {
    await this.login();
    const params = new URLSearchParams({
      hashes: hash,
      deleteFiles: String(deleteFiles),
    });
    await this.http.post('/torrents/delete', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    getLogger().info('Torrent deleted from qBittorrent', { hash, deleteFiles });
  }

  async setCategory(hash: string, category: string): Promise<void> {
    await this.login();
    const params = new URLSearchParams({ hashes: hash, category });
    await this.http.post('/torrents/setCategory', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  /**
   * Copy all media files from a completed torrent's content path into queueDir.
   * Returns the list of files copied.
   */
  async stageForProcessing(
    torrent: TorrentInfo,
    queueDir: string,
    videoExtensions: Set<string>,
  ): Promise<string[]> {
    const staged: string[] = [];
    const src = torrent.contentPath;

    if (!fs.existsSync(src)) {
      getLogger().warning('Torrent content path does not exist', { contentPath: src });
      return staged;
    }

    const collect = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(full);
        } else if (videoExtensions.has(path.extname(entry.name).toLowerCase())) {
          const dest = path.join(queueDir, entry.name);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(full, dest);
            staged.push(dest);
            getLogger().info('Staged torrent file for processing', {
              src: full,
              dest,
            });
          }
        }
      }
    };

    fs.mkdirSync(queueDir, { recursive: true });
    if (fs.statSync(src).isDirectory()) {
      collect(src);
    } else if (videoExtensions.has(path.extname(src).toLowerCase())) {
      const dest = path.join(queueDir, path.basename(src));
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        staged.push(dest);
      }
    }

    return staged;
  }
}

export function isQBittorrentConfigured(): boolean {
  return QB_URL.length > 0;
}
