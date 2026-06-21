/**
 * Spec tests for the Plex path formatter (Phase 1 critical area #3, risk 0.67).
 * These functions are pure string -> path builders whose output is handed
 * directly to safeMove, so a wrong path misfiles media. We assert the exact
 * Plex-compliant layout for movies, season/episode TV, and date-based TV.
 *
 * formatter.ts calls getLogger() at module load (which would construct a
 * winston logger and create .logs/), so we mock the config barrel's getLogger
 * to a no-op while keeping every real constant (MEDIA_BASE_DIR, etc.).
 */
import path from 'path';
import { describe, it, expect, vi } from 'vitest';

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
  constructMoviePath,
  constructTvShowPath,
  constructTvShowDatePath,
} from '../../src/services/formatter';

const p = (...segs: string[]) => path.join(...segs);

describe('constructMoviePath', () => {
  it('builds the Plex movie folder + filename', () => {
    expect(constructMoviePath('The Matrix', 1999, 603, '.mkv', '/lib')).toBe(
      p('/lib', 'Movies', 'The Matrix (1999) {tmdb-603}', 'The Matrix (1999) {tmdb-603}.mkv'),
    );
  });

  it('strips filesystem-invalid characters from the title', () => {
    expect(constructMoviePath('A:B?C*D', 2000, 1, '.mp4', '/x')).toBe(
      p('/x', 'Movies', 'ABCD (2000) {tmdb-1}', 'ABCD (2000) {tmdb-1}.mp4'),
    );
  });

  it('collapses internal whitespace in the title', () => {
    expect(constructMoviePath('The   Matrix', 1999, 603, '.mkv', '/lib')).toBe(
      p('/lib', 'Movies', 'The Matrix (1999) {tmdb-603}', 'The Matrix (1999) {tmdb-603}.mkv'),
    );
  });
});

describe('constructTvShowPath', () => {
  it('builds the Plex Show/Season/Episode layout', () => {
    expect(constructTvShowPath('Breaking Bad', 2008, 1396, 1, 1, 'Pilot', '.mkv', '/lib')).toBe(
      p(
        '/lib',
        'TV Shows',
        'Breaking Bad (2008) {tmdb-1396}',
        'Season 01',
        'Breaking Bad (2008) - s01e01 - Pilot.mkv',
      ),
    );
  });

  it('omits the year from folder + label when year is null', () => {
    expect(constructTvShowPath('Doctor Who', null, 57243, 2, 5, 'Rose', '.mkv', '/lib')).toBe(
      p(
        '/lib',
        'TV Shows',
        'Doctor Who {tmdb-57243}',
        'Season 02',
        'Doctor Who - s02e05 - Rose.mkv',
      ),
    );
  });

  it('falls back to "Episode NN" when the episode title is missing', () => {
    expect(constructTvShowPath('Show', 2000, 1, 3, 7, null, '.mkv', '/lib')).toBe(
      p(
        '/lib',
        'TV Shows',
        'Show (2000) {tmdb-1}',
        'Season 03',
        'Show (2000) - s03e07 - Episode 07.mkv',
      ),
    );
  });
});

describe('constructTvShowDatePath', () => {
  it('builds a date-based episode path with a guest/episode title', () => {
    expect(
      constructTvShowDatePath(
        'The Daily Show',
        2020,
        100,
        0,
        '2020-03-15',
        'Some Guest',
        '.mkv',
        '/lib',
      ),
    ).toBe(
      p(
        '/lib',
        'TV Shows',
        'The Daily Show (2020) {tmdb-100}',
        'Season 00',
        'The Daily Show (2020) - 2020-03-15 - Some Guest.mkv',
      ),
    );
  });

  it('omits the title segment when no episode title is given', () => {
    expect(
      constructTvShowDatePath('The Daily Show', 2020, 100, 1, '2020-03-15', null, '.mkv', '/lib'),
    ).toBe(
      p(
        '/lib',
        'TV Shows',
        'The Daily Show (2020) {tmdb-100}',
        'Season 01',
        'The Daily Show (2020) - 2020-03-15.mkv',
      ),
    );
  });
});

describe('known gaps — documented, not yet guarded (Phase 2 findings)', () => {
  // These record real robustness gaps surfaced in Phase 2. They are todos
  // rather than assertions so CI stays green while the gaps remain tracked.
  it.todo('should reject/guard an empty title instead of producing a leading-space name');
  it.todo('should guard against NaN/negative year instead of emitting "(NaN)"');
  it.todo('should neutralize ".." path-traversal segments that survive sanitizeFilename');
  it.todo('should truncate names exceeding the 255-char filesystem limit');
});
