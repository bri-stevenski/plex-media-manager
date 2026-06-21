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

import { safeMove } from '../../src/repository/fs';

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
