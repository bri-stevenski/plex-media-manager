/**
 * Tests for environment/config resolution (Phase 1 critical area #5, risk 0.62).
 * env.ts is the most-depended-on module (feeds logger, fs, tmdb, formatter); a
 * misresolved base dir or subfolder routes files to the wrong place.
 *
 * The folder constants are computed once at module load from process.env, so we
 * exercise the real public surface by mutating process.env and re-importing the
 * module (vi.resetModules + dynamic import) rather than exporting internals.
 * env.ts is a leaf (only imports dotenv + path), so no logger mock is needed.
 */
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'MEDIA_BASE_DIR',
  'QUEUE_FOLDER',
  'QUEUE_DIR',
  'PROCESSING_FOLDER',
  'PROCESSING_DIR',
  'COMPLETED_FOLDER',
  'COMPLETED_DIR',
  'PROCESSED_FOLDER',
  'PROCESSED_DIR',
  'FAILED_FOLDER',
  'FAILED_DIR',
  'BACKUP_FOLDER',
  'BACKUP_DIR',
  'TMDB_API_KEY',
  'LOG_LEVEL',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k]; // start each test from a clean slate
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const loadEnv = async () => {
  vi.resetModules();
  return import('../../src/config/env');
};

describe('subfolder defaults', () => {
  it('falls back to the canonical names when unset', async () => {
    const env = await loadEnv();
    expect(env.QUEUE_FOLDER).toBe('queue');
    expect(env.PROCESSING_FOLDER).toBe('processing');
    expect(env.COMPLETED_FOLDER).toBe('completed');
    expect(env.FAILED_FOLDER).toBe('failed');
    expect(env.BACKUP_FOLDER).toBe('backups');
  });
});

describe('subfolder normalization', () => {
  it('uses an explicit override verbatim', async () => {
    process.env.QUEUE_FOLDER = 'inbox';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('inbox');
  });

  it('strips leading and trailing slashes (both separators)', async () => {
    process.env.QUEUE_FOLDER = '/incoming/';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('incoming');
    process.env.QUEUE_FOLDER = '\\win\\';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('win');
  });

  it('preserves internal separators', async () => {
    process.env.COMPLETED_FOLDER = 'done/movies';
    expect((await loadEnv()).COMPLETED_FOLDER).toBe('done/movies');
  });

  it('falls back when the value is only separators or whitespace', async () => {
    process.env.QUEUE_FOLDER = '///';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('queue');
    process.env.QUEUE_FOLDER = '   ';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('queue');
  });
});

describe('env-var precedence', () => {
  it('falls back to the legacy *_DIR variable when *_FOLDER is unset', async () => {
    process.env.QUEUE_DIR = 'legacy-queue';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('legacy-queue');
  });

  it('prefers *_FOLDER over the legacy *_DIR when both are set', async () => {
    process.env.QUEUE_FOLDER = 'new-queue';
    process.env.QUEUE_DIR = 'old-queue';
    expect((await loadEnv()).QUEUE_FOLDER).toBe('new-queue');
  });

  it('resolves COMPLETED through its 4-way fallback chain (PROCESSED_DIR last)', async () => {
    process.env.PROCESSED_DIR = 'processed-only';
    expect((await loadEnv()).COMPLETED_FOLDER).toBe('processed-only');
  });
});

describe('MEDIA_BASE_DIR resolution', () => {
  it('resolves a relative override to an absolute path', async () => {
    process.env.MEDIA_BASE_DIR = 'custom-media';
    const env = await loadEnv();
    expect(path.isAbsolute(env.MEDIA_BASE_DIR)).toBe(true);
    expect(env.MEDIA_BASE_DIR.endsWith(`${path.sep}custom-media`)).toBe(true);
  });

  it('uses an absolute override as-is', async () => {
    const abs = path.join(path.sep, 'mnt', 'media');
    process.env.MEDIA_BASE_DIR = abs;
    expect((await loadEnv()).MEDIA_BASE_DIR).toBe(abs);
  });
});

describe('logging + TMDb config', () => {
  it('defaults the log level to INFO and uppercases an override', async () => {
    expect((await loadEnv()).DEFAULT_LOG_LEVEL).toBe('INFO');
    process.env.LOG_LEVEL = 'debug';
    expect((await loadEnv()).DEFAULT_LOG_LEVEL).toBe('DEBUG');
  });

  it('reads TMDB_API_KEY, defaulting to an empty string when unset', async () => {
    expect((await loadEnv()).TMDB_API_KEY).toBe('');
    process.env.TMDB_API_KEY = 'secret-key';
    expect((await loadEnv()).TMDB_API_KEY).toBe('secret-key');
  });
});
