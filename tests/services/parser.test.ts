/**
 * Characterization + spec tests for the filename parser (Phase 1 critical area
 * #2, risk 0.79). parseMediaFile's output becomes the write destination, so a
 * misclassification silently misfiles a user's media — these tests pin the
 * movie/TV/date classification and the title/year/season/episode extraction.
 *
 * parser.ts imports only constants from ../config (no getLogger at module
 * scope), so no logger mock is required here.
 */
import path from 'path';
import { describe, it, expect } from 'vitest';
import { parseMediaFile } from '../../src/services/parser';

// Build paths with the platform separator so assertions hold on win32 too.
const p = (...segs: string[]) => path.join(...segs);

describe('parseMediaFile — movies', () => {
  it('parses a Plex-style movie folder + file', () => {
    const info = parseMediaFile(
      p('/media', 'Movies', 'The Matrix (1999)', 'The Matrix (1999).mkv'),
    );
    expect(info.content_type).toBe('Movies');
    expect(info.title).toBe('The Matrix');
    expect(info.year).toBe(1999);
    expect(info.season).toBeNull();
    expect(info.episode).toBeNull();
  });

  it('extracts title + year from a noisy release filename (no parent folder hint)', () => {
    const info = parseMediaFile(p('/downloads', 'Inception.2010.1080p.BluRay.x264.mkv'));
    expect(info.content_type).toBe('Movies');
    expect(info.title).toBe('Inception');
    expect(info.year).toBe(2010);
  });

  it('recovers title/year from a folder carrying a {tmdb-id} tag', () => {
    const info = parseMediaFile(
      p('/media', 'Movies', 'Hamilton (2020) {tmdb-556574}', 'Hamilton.mkv'),
    );
    expect(info.content_type).toBe('Movies');
    expect(info.title).toBe('Hamilton');
    expect(info.year).toBe(2020);
  });
});

describe('parseMediaFile — TV (season/episode)', () => {
  it('parses S01E01 with episode title from a TV Shows tree', () => {
    const info = parseMediaFile(
      p(
        '/media',
        'TV Shows',
        'Breaking Bad (2008)',
        'Season 01',
        'Breaking Bad - s01e01 - Pilot.mkv',
      ),
    );
    expect(info.content_type).toBe('TV Shows');
    expect(info.title).toBe('Breaking Bad');
    expect(info.year).toBe(2008);
    expect(info.season).toBe(1);
    expect(info.episode).toBe(1);
    expect(info.episode_title).toBe('Pilot');
  });

  it('parses the NxNN shorthand (e.g. 6x10)', () => {
    const info = parseMediaFile(p('/media', 'TV Shows', 'Friends', 'Friends 6x10.mkv'));
    expect(info.content_type).toBe('TV Shows');
    expect(info.season).toBe(6);
    expect(info.episode).toBe(10);
  });
});

describe('parseMediaFile — TV (date-based)', () => {
  it('parses a YYYY-MM-DD air date into date_str + year', () => {
    const info = parseMediaFile(
      p('/media', 'TV Shows', 'The Daily Show', 'The Daily Show - 2020-03-15.mkv'),
    );
    expect(info.content_type).toBe('TV Shows');
    expect(info.title).toBe('The Daily Show');
    expect(info.date_str).toBe('2020-03-15');
    expect(info.year).toBe(2020);
  });
});

describe('parseMediaFile — classification edge cases (Phase 2)', () => {
  it('treats a file under a Movies folder as a movie even if it contains SxxExx', () => {
    // isInMoviesFolder takes precedence over season/episode detection.
    const info = parseMediaFile(p('/media', 'Movies', 'Weird.s01e01.mkv'));
    expect(info.content_type).toBe('Movies');
  });

  it('ignores a year outside the 1900–2099 guard', () => {
    const info = parseMediaFile(p('/downloads', 'Old Film 1850.mkv'));
    expect(info.year).toBeNull();
  });
});

describe('parseMediaFile — flat TV files (no show subfolder)', () => {
  it('derives the show title from the filename when a season file sits directly under TV Shows', () => {
    const info = parseMediaFile(
      p('/media', 'TV Shows', 'The.Office.US.S03E10.Christmas.Party.1080p.mkv'),
    );
    expect(info.content_type).toBe('TV Shows');
    expect(info.title).toBe('The Office US'); // not "The Office US Christmas Party mkv"
    expect(info.season).toBe(3);
    expect(info.episode).toBe(10);
  });

  it('derives the show title for a flat date-based file', () => {
    const info = parseMediaFile(
      p('/media', 'TV Shows', 'The.Daily.Show.2020-03-15.Jon.Stewart.mkv'),
    );
    expect(info.content_type).toBe('TV Shows');
    expect(info.title).toBe('The Daily Show'); // not "The Daily Show 03 15 Jon Stewart mkv"
    expect(info.date_str).toBe('2020-03-15');
  });

  it('still prefers a real show folder (with year) over the filename', () => {
    // Regression: a Season-foldered show without a "TV Shows" ancestor must keep
    // using the folder name — and its year.
    const info = parseMediaFile(
      p('/library', 'Breaking Bad (2008)', 'Season 01', 'Breaking Bad - s01e01 - Pilot.mkv'),
    );
    expect(info.title).toBe('Breaking Bad');
    expect(info.year).toBe(2008);
    expect(info.season).toBe(1);
    expect(info.episode).toBe(1);
  });
});
