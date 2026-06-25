/**
 * Tests for safe filesystem operations (Phase 1 critical area #1, risk 0.83) —
 * the only code that mutates/deletes the user's library, so a bug here loses
 * data. Uses a real temp-dir harness (no fs mocks): these functions ARE the
 * filesystem behavior, so real I/O is the honest test.
 *
 * fs.ts calls getLogger() at module load (winston + .logs side effect); we mock
 * the config barrel's getLogger to a no-op while keeping real constants.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    getLogger: () => ({
      debug: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    }),
  };
});

import {
  moveSidecarFiles,
  pruneEmptyDirectories,
  removeKnownQueueArtifacts,
  safeMove,
  scanMediaFiles,
} from '../../src/repository/fs';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-fs-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (rel: string, contents: string): string => {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
};

describe('safeMove — overwrite protection (data-loss guard)', () => {
  it('does NOT overwrite an existing destination and returns false', () => {
    const source = write('src/movie.mkv', 'NEW');
    const dest = write('lib/movie.mkv', 'EXISTING');

    const result = safeMove(source, dest);

    expect(result).toBe(false);
    // The existing destination must be untouched.
    expect(fs.readFileSync(dest, 'utf8')).toBe('EXISTING');
    // The source must remain (caller decides what to do next).
    expect(fs.existsSync(source)).toBe(true);
  });
});

describe('safeMove — normal operation', () => {
  it('moves a file to a new destination and reports success', () => {
    const source = write('src/movie.mkv', 'CONTENT');
    const dest = path.join(tmp, 'lib', 'Movies', 'movie.mkv');

    const result = safeMove(source, dest);

    expect(result).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(dest, 'utf8')).toBe('CONTENT');
  });

  it('creates the destination directory tree if it does not exist', () => {
    const source = write('src/show.mkv', 'X');
    const dest = path.join(tmp, 'lib', 'TV Shows', 'Show (2020)', 'Season 01', 'ep.mkv');

    expect(safeMove(source, dest)).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('returns false when the source file does not exist', () => {
    const source = path.join(tmp, 'src', 'missing.mkv');
    const dest = path.join(tmp, 'lib', 'missing.mkv');

    expect(safeMove(source, dest)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('scanMediaFiles — symlink cycle protection', () => {
  it('terminates on a self-referential symlink cycle instead of infinite-looping', () => {
    const root = path.join(tmp, 'lib');
    fs.mkdirSync(root, { recursive: true });
    const movie = path.join(root, 'movie.mkv');
    fs.writeFileSync(movie, 'x');
    // A directory symlink pointing back at its own parent: scanning must not
    // recurse into it forever.
    try {
      fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
    } catch (e: any) {
      if (e.code === 'EPERM') return; // Windows requires elevated privileges for symlinks
      throw e;
    }

    const found = Array.from(scanMediaFiles(root));

    expect(found).toContain(movie);
  });
});

describe('scanMediaFiles — normal traversal', () => {
  it('yields only video files, recursing into real subdirectories', () => {
    fs.mkdirSync(path.join(tmp, 'lib', 'Season 01'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'lib', 'a.mkv'), 'x');
    fs.writeFileSync(path.join(tmp, 'lib', 'notes.txt'), 'x'); // non-video, skipped
    fs.writeFileSync(path.join(tmp, 'lib', 'Season 01', 'b.mp4'), 'x');

    const found = Array.from(scanMediaFiles(path.join(tmp, 'lib'))).sort();

    expect(found).toEqual(
      [path.join(tmp, 'lib', 'Season 01', 'b.mp4'), path.join(tmp, 'lib', 'a.mkv')].sort(),
    );
  });
});

describe('moveSidecarFiles', () => {
  it('moves matching subtitle/nfo sidecars and renames them to the destination stem', () => {
    const srcDir = path.join(tmp, 'queue');
    const destDir = path.join(tmp, 'lib', 'Movies', 'Movie (2024) {tmdb-1}');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
    write('queue/Movie.2024.mkv', 'video'); // the media file itself (not a sidecar)
    write('queue/Movie.2024.srt', 'sub'); // exact-stem sidecar
    write('queue/Movie.2024.en.srt', 'sub-en'); // stem-prefix sidecar (language suffix)
    write('queue/Movie.2024.jpg', 'art'); // non-sidecar extension, ignored
    write('queue/Other.srt', 'other'); // sidecar ext but different stem, ignored

    const source = path.join(srcDir, 'Movie.2024.mkv');
    const dest = path.join(destDir, 'Movie (2024) {tmdb-1}.mkv');
    const summary = moveSidecarFiles(source, dest);

    expect(summary).toEqual({ moved: 2, skipped: 0, failed: 0 });
    expect(fs.existsSync(path.join(destDir, 'Movie (2024) {tmdb-1}.srt'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'Movie (2024) {tmdb-1}.en.srt'))).toBe(true);
    // Non-matching files stay in the source directory.
    expect(fs.existsSync(path.join(srcDir, 'Movie.2024.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, 'Other.srt'))).toBe(true);
  });

  it('skips a sidecar whose destination already exists (no overwrite)', () => {
    const srcDir = path.join(tmp, 'queue');
    const destDir = path.join(tmp, 'lib');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
    write('queue/Movie.2024.mkv', 'video');
    write('queue/Movie.2024.srt', 'new-sub');
    write('lib/Movie (2024).srt', 'existing-sub'); // collision at destination

    const summary = moveSidecarFiles(
      path.join(srcDir, 'Movie.2024.mkv'),
      path.join(destDir, 'Movie (2024).mkv'),
    );

    expect(summary).toEqual({ moved: 0, skipped: 1, failed: 0 });
    expect(fs.readFileSync(path.join(destDir, 'Movie (2024).srt'), 'utf8')).toBe('existing-sub');
    expect(fs.existsSync(path.join(srcDir, 'Movie.2024.srt'))).toBe(true);
  });
});

describe('removeKnownQueueArtifacts', () => {
  it('deletes known junk files (case-insensitive) and leaves real files alone', () => {
    const dir = path.join(tmp, 'queue');
    fs.mkdirSync(dir, { recursive: true });
    write('queue/RARBG.txt', 'junk'); // matches /^rarbg\.txt$/i
    write('queue/www.YTS.MX.jpg', 'junk'); // matches the yts pattern
    write('queue/movie.mkv', 'keep');
    write('queue/movie.nfo', 'keep'); // legitimate sidecar, not an artifact

    const deleted = removeKnownQueueArtifacts(dir);

    expect(deleted).toBe(2);
    expect(fs.existsSync(path.join(dir, 'RARBG.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'www.YTS.MX.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'movie.mkv'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'movie.nfo'))).toBe(true);
  });

  it('returns 0 for a non-existent directory', () => {
    expect(removeKnownQueueArtifacts(path.join(tmp, 'nope'))).toBe(0);
  });
});

describe('pruneEmptyDirectories', () => {
  it('removes empty directories upward up to (but not including) the stop dir', () => {
    const stop = path.join(tmp, 'queue');
    const deep = path.join(stop, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });

    const removed = pruneEmptyDirectories(deep, stop);

    expect(removed).toBe(3);
    expect(fs.existsSync(path.join(stop, 'a'))).toBe(false);
    expect(fs.existsSync(stop)).toBe(true); // stop dir is preserved
  });

  it('stops at the first non-empty ancestor', () => {
    const stop = path.join(tmp, 'queue');
    const deep = path.join(stop, 'a', 'b');
    fs.mkdirSync(deep, { recursive: true });
    write('queue/a/keep.mkv', 'x'); // makes 'a' non-empty

    const removed = pruneEmptyDirectories(deep, stop);

    expect(removed).toBe(1); // only 'b'
    expect(fs.existsSync(path.join(stop, 'a'))).toBe(true);
    expect(fs.existsSync(deep)).toBe(false);
  });

  it('does nothing when startDir is outside stopDir', () => {
    const stop = path.join(tmp, 'queue');
    const outside = path.join(tmp, 'elsewhere');
    fs.mkdirSync(stop, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    expect(pruneEmptyDirectories(outside, stop)).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
  });
});
