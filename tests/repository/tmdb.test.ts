/**
 * Tests for the TMDb client (Phase 1 critical area #4, risk 0.63). Wrong
 * matches => wrong metadata => misfiled media; flaky network handling => failed
 * runs. We mock axios (no real HTTP) and use fake timers for the retry/backoff
 * paths so tests are fast and deterministic.
 *
 * tmdb.ts calls getLogger() at module load (winston + .logs side effect) and
 * reads TMDB_API_KEY; we mock the config barrel to a no-op logger and a known
 * empty key, keeping the other real constants.
 */
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');

vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    TMDB_API_KEY: '',
    getLogger: () => ({
      debug: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    }),
  };
});

import { TMDbClient, TMDbAPIError, TMDbError } from '../../src/repository/tmdb';

type GetFn = (url: string, config?: { params?: Record<string, unknown> }) => Promise<unknown>;

/** Build a client whose axios session.get is driven by the supplied impl. */
const makeClient = (get: GetFn): TMDbClient => {
  vi.mocked(axios.create).mockReturnValue({ get } as never);
  return new TMDbClient('test-key');
};

const axiosError = (over: Record<string, unknown>) => ({
  isAxiosError: true,
  message: 'request failed',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The client uses axios.isAxiosError to classify retryable failures.
  vi.mocked(axios.isAxiosError).mockImplementation(
    (e: unknown): e is import('axios').AxiosError =>
      typeof e === 'object' &&
      e !== null &&
      (e as { isAxiosError?: boolean }).isAxiosError === true,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('constructor', () => {
  it('throws when no API key is available', () => {
    expect(() => new TMDbClient('')).toThrow(TMDbError);
    expect(() => new TMDbClient('')).toThrow(/API key is required/);
  });

  it('accepts an explicit API key', () => {
    expect(() => makeClient(async () => ({ data: {} }))).not.toThrow();
  });
});

describe('searchMovie', () => {
  it('returns the results array from the response', async () => {
    const client = makeClient(async () => ({ data: { results: [{ id: 1 }, { id: 2 }] } }));
    expect(await client.searchMovie('Heat')).toHaveLength(2);
  });

  it('caches identical searches (one network call for repeated queries)', async () => {
    const get = vi.fn(async () => ({ data: { results: [{ id: 1 }] } }));
    const client = makeClient(get);

    await client.searchMovie('Heat', 1995);
    await client.searchMovie('Heat', 1995);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when TMDb has no results', async () => {
    const client = makeClient(async () => ({ data: { results: [] } }));
    expect(await client.searchMovie('Nonexistent')).toEqual([]);
  });
});

describe('findBestMovieMatch — scoring', () => {
  it('prefers the exact title + exact year over a near title in another year', async () => {
    const client = makeClient(async () => ({
      data: {
        results: [
          { id: 604, title: 'The Matrix Reloaded', release_date: '2003-05-15', popularity: 40 },
          {
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-31',
            popularity: 50,
            vote_count: 1000,
          },
        ],
      },
    }));

    const best = await client.findBestMovieMatch('The Matrix', 1999);
    expect(best?.id).toBe(603);
  });

  it('retries without the year filter when a year-scoped search returns nothing', async () => {
    const get = vi.fn(async (_url: string, config?: { params?: Record<string, unknown> }) => {
      if (config?.params?.year) return { data: { results: [] } };
      return { data: { results: [{ id: 999, title: 'Obscure', release_date: '1980-01-01' }] } };
    });
    const client = makeClient(get);

    const best = await client.findBestMovieMatch('Obscure', 2020);
    expect(best?.id).toBe(999);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('returns null when no results exist even without a year filter', async () => {
    const client = makeClient(async () => ({ data: { results: [] } }));
    expect(await client.findBestMovieMatch('Ghost', 2020)).toBeNull();
  });
});

describe('findBestTvMatch', () => {
  it('returns the result whose first_air_date matches the requested year', async () => {
    const client = makeClient(async () => ({
      data: {
        results: [
          { id: 1, name: 'Show', first_air_date: '2010-01-01' },
          { id: 2, name: 'Show', first_air_date: '2008-09-01' },
        ],
      },
    }));

    const best = await client.findBestTvMatch('Show', 2008);
    expect(best?.id).toBe(2);
  });

  it('falls back to an alternative title (stripping " US")', async () => {
    const get = vi.fn(async (_url: string, config?: { params?: Record<string, unknown> }) => {
      if (config?.params?.query === 'The Office') {
        return { data: { results: [{ id: 2316, name: 'The Office' }] } };
      }
      return { data: { results: [] } };
    });
    const client = makeClient(get);

    const best = await client.findBestTvMatch('The Office US', 2005);
    expect(best?.id).toBe(2316);
  });
});

describe('retry + error handling', () => {
  it('retries a retryable failure (HTTP 429) then succeeds', async () => {
    vi.useFakeTimers();
    const get = vi
      .fn()
      .mockRejectedValueOnce(axiosError({ response: { status: 429 } }))
      .mockResolvedValueOnce({ data: { results: [{ id: 7 }] } });
    const client = makeClient(get);

    const promise = client.searchMovie('Rate Limited');
    await vi.advanceTimersByTimeAsync(1000); // RETRY_DELAY * attempt 1
    const results = await promise;

    expect(results).toEqual([{ id: 7 }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable failure (HTTP 401) and throws TMDbAPIError', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(
        axiosError({ response: { status: 401 }, message: 'Request failed with status code 401' }),
      );
    const client = makeClient(get);

    await expect(client.searchMovie('Unauthorized')).rejects.toThrow(TMDbAPIError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('getEpisodeInfo returns null on a 404 instead of throwing', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(
        axiosError({ response: { status: 404 }, message: 'Request failed with status code 404' }),
      );
    const client = makeClient(get);

    expect(await client.getEpisodeInfo(123, 1, 1)).toBeNull();
  });
});
