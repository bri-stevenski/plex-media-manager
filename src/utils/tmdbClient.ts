/**
 * TMDb API client for fetching movie and TV show metadata.
 *
 * This module provides a clean interface to The Movie Database API,
 * handling search requests, error handling, and response parsing.
 */

import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { TMDB_API_KEY, TMDB_BASE_URL } from './constants';
import { getLogger } from './logger';

const logger = getLogger();

export class TMDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TMDbError';
  }
}

export class TMDbAPIError extends TMDbError {
  constructor(message: string) {
    super(message);
    this.name = 'TMDbAPIError';
  }
}

export class TMDbNotFoundError extends TMDbError {
  constructor(message: string) {
    super(message);
    this.name = 'TMDbNotFoundError';
  }
}

export class TMDbClient {
  private apiKey: string;
  private baseUrl: string;
  private session: AxiosInstance;
  private movieSearchCache: Map<string, Record<string, any>[]>;
  private tvShowSearchCache: Map<string, Record<string, any>[]>;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || TMDB_API_KEY;
    if (!this.apiKey) {
      throw new TMDbError('TMDb API key is required. Set TMDB_API_KEY environment variable.');
    }

    this.baseUrl = TMDB_BASE_URL;
    this.session = axios.create({
      baseURL: this.baseUrl,
      params: {
        api_key: this.apiKey,
      },
      timeout: 30000,
    });

    // Initialize search result caches
    this.movieSearchCache = new Map();
    this.tvShowSearchCache = new Map();
  }

  private async makeRequest(
    endpoint: string,
    params?: Record<string, any>,
  ): Promise<Record<string, any>> {
    const url = `/${endpoint.replace(/^\//, '')}`;

    try {
      logger.debug(`TMDb API request: ${url}`);
      if (params) {
        const safeParams = { ...params };
        delete safeParams.api_key;
        logger.debug(`Request params: ${JSON.stringify(safeParams)}`);
      }

      const response = await this.session.get(url, { params });
      const data = response.data;

      if (data.success === false) {
        logger.error(`❌ TMDb API error: ${data.status_message || 'Unknown error'}`);
        throw new TMDbAPIError(`TMDb API error: ${data.status_message || 'Unknown error'}`);
      }

      if (data.results) {
        logger.debug(`TMDb response: ${data.results.length} results found`);
      } else {
        logger.debug('TMDb response: success');
      }

      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`TMDb request failed: ${error.message}`);
        throw new TMDbAPIError(`Request failed: ${error.message}`);
      }
      throw error;
    }
  }

  async searchMovie(title: string, year?: number): Promise<Record<string, any>[]> {
    const cacheKey = `${title}:${year || 'any'}`;

    // Check cache first
    if (this.movieSearchCache.has(cacheKey)) {
      logger.debug(`Cache hit for movie search: '${title}' (${year || 'any year'})`);
      return this.movieSearchCache.get(cacheKey)!;
    }

    const params: Record<string, any> = { query: title };
    if (year) {
      params.year = String(year);
    }

    logger.info(`Searching TMDb for movie: '${title}' (${year || 'any year'})`);
    const data = await this.makeRequest('search/movie', params);
    const results = data.results || [];
    logger.info(`TMDb returned ${results.length} movie results`);

    if (results.length > 0) {
      logger.debug('Top TMDb movie results:');
      results.slice(0, 3).forEach((result: Record<string, any>, i: number) => {
        logger.debug(
          `  ${i + 1}. ${result.title} (${result.release_date || 'Unknown'}) - ID: ${result.id}`,
        );
      });
    } else {
      logger.warning(`No TMDb movie results found for: '${title}' (${year || 'any year'})`);
    }

    // Store in cache
    this.movieSearchCache.set(cacheKey, results);

    return results;
  }

  async searchTvShow(title: string, firstAirDateYear?: number): Promise<Record<string, any>[]> {
    const cacheKey = `${title}:${firstAirDateYear || 'any'}`;

    // Check cache first
    if (this.tvShowSearchCache.has(cacheKey)) {
      logger.debug(`Cache hit for TV show search: '${title}' (${firstAirDateYear || 'any year'})`);
      return this.tvShowSearchCache.get(cacheKey)!;
    }

    const params: Record<string, any> = { query: title };
    if (firstAirDateYear) {
      params.first_air_date_year = String(firstAirDateYear);
    }

    logger.info(`Searching TMDb for TV show: '${title}' (${firstAirDateYear || 'any year'})`);
    const data = await this.makeRequest('search/tv', params);
    const results = data.results || [];
    logger.info(`TMDb returned ${results.length} TV show results`);

    if (results.length > 0) {
      logger.debug('Top TMDb TV results:');
      results.slice(0, 3).forEach((result: Record<string, any>, i: number) => {
        logger.debug(
          `  ${i + 1}. ${result.name} (${result.first_air_date || 'Unknown'}) - ID: ${result.id}`,
        );
      });
    } else {
      logger.warning(
        `No TMDb TV results found for: '${title}' (${firstAirDateYear || 'any year'})`,
      );
    }

    // Store in cache
    this.tvShowSearchCache.set(cacheKey, results);

    return results;
  }

  async getMovieDetails(tmdbId: number): Promise<Record<string, any>> {
    logger.debug(`Getting movie details for ID: ${tmdbId}`);
    return this.makeRequest(`movie/${tmdbId}`);
  }

  async getTvShowDetails(tmdbId: number): Promise<Record<string, any>> {
    logger.debug(`Getting TV show details for ID: ${tmdbId}`);
    return this.makeRequest(`tv/${tmdbId}`);
  }

  async getTvEpisodeDetails(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    episodeTitle?: string,
  ): Promise<Record<string, any>> {
    let finalSeasonNumber = seasonNumber;
    let finalEpisodeNumber = episodeNumber;

    if (episodeTitle && episodeTitle !== '') {
      logger.debug(`Getting episode details for show ID ${tmdbId} with title '${episodeTitle}'`);

      try {
        const seasonData = await this.makeRequest(`tv/${tmdbId}/season/${seasonNumber}`);
        const episodes = seasonData.episodes || [];

        let found = false;
        for (const episode of episodes) {
          if (episode.name?.toLowerCase() === episodeTitle.toLowerCase()) {
            finalEpisodeNumber = episode.episode_number;
            logger.debug(
              `Found episode '${episodeTitle}' as S${seasonNumber}E${finalEpisodeNumber}`,
            );
            found = true;
            break;
          }
        }

        if (!found) {
          logger.error(
            `Episode titled '${episodeTitle}' not found in season ${seasonNumber} of show ID ${tmdbId}, searching all seasons...`,
          );

          const tvData = await this.getTvShowDetails(tmdbId);
          for (const season of tvData.seasons || []) {
            const seasonNum = season.season_number;
            const seasonDataSearch = await this.makeRequest(`tv/${tmdbId}/season/${seasonNum}`);
            const episodesSearch = seasonDataSearch.episodes || [];

            for (const episode of episodesSearch) {
              if (episode.name?.toLowerCase() === episodeTitle.toLowerCase()) {
                finalEpisodeNumber = episode.episode_number;
                finalSeasonNumber = seasonNum;
                logger.debug(
                  `Found episode '${episodeTitle}' as S${finalSeasonNumber}E${finalEpisodeNumber}`,
                );
                found = true;
                break;
              }
            }

            if (found) break;
          }
        }
      } catch (error) {
        logger.error(`Error searching for episode by title: ${error}`);
      }
    }

    logger.debug(
      `Getting episode details for show ID ${tmdbId}, S${finalSeasonNumber}E${finalEpisodeNumber}`,
    );
    const episodeData = await this.makeRequest(
      `tv/${tmdbId}/season/${finalSeasonNumber}/episode/${finalEpisodeNumber}`,
    );

    // Include the corrected season and episode numbers in the response
    episodeData.season_number = finalSeasonNumber;
    episodeData.episode_number = finalEpisodeNumber;

    return episodeData;
  }

  async findBestMovieMatch(title: string, year?: number): Promise<Record<string, any> | null> {
    let results = await this.searchMovie(title, year);

    if (results.length === 0) {
      logger.warning(`No TMDb results found for movie: '${title}' (${year || 'any year'})`);

      // Try alternative search without year
      if (year) {
        logger.info(`Retrying movie search without year filter: '${title}'`);
        results = await this.searchMovie(title);

        if (results.length > 0) {
          const result = results[0];
          logger.info(
            `Using best match (no year): '${result.title}' (${result.release_date}) - ID: ${result.id}`,
          );
          return result;
        }
      }

      return null;
    }

    // If we have a year, prefer exact year matches
    if (year) {
      const exactMatches = results.filter((r) => (r.release_date || '').startsWith(String(year)));
      if (exactMatches.length > 0) {
        const result = exactMatches[0];
        logger.info(`Found exact year match: '${result.title}' (${result.release_date})`);
        return result;
      }
    }

    // Return the first (highest rated) result
    const result = results[0];
    logger.info(`Using best match: '${result.title}' (${result.release_date}) - ID: ${result.id}`);
    return result;
  }

  async findBestTvMatch(
    title: string,
    year?: number,
    _useEpisodeTitles: boolean = false,
  ): Promise<Record<string, any> | null> {
    let results = await this.searchTvShow(title, year);

    if (results.length === 0) {
      logger.warning(`No TMDb results found for TV show: '${title}' (${year || 'any year'})`);

      // Try alternative search strategies
      const alternativeTitles = [
        title.replace(' US', ''),
        title.replace(' (US)', ''),
        title.replace(' UK', ''),
        title.replace(' (UK)', ''),
        title.replace(/ /g, ''),
      ];

      for (const altTitle of alternativeTitles) {
        if (altTitle !== title) {
          logger.info(`Trying alternative title: '${altTitle}'`);
          results = await this.searchTvShow(altTitle, year);

          if (results.length > 0) {
            const result = results[0];
            logger.info(
              `Found match with alternative title: '${result.name}' (${result.first_air_date}) - ID: ${result.id}`,
            );
            return result;
          }
        }
      }

      // Try without year filter
      if (year) {
        logger.info(`Retrying TV search without year filter: '${title}'`);
        results = await this.searchTvShow(title);

        if (results.length > 0) {
          const result = results[0];
          logger.info(
            `Using best match (no year): '${result.name}' (${result.first_air_date}) - ID: ${result.id}`,
          );
          return result;
        }
      }

      return null;
    }

    // If we have a year, prefer exact year matches
    if (year) {
      const exactMatches = results.filter((r) => (r.first_air_date || '').startsWith(String(year)));
      if (exactMatches.length > 0) {
        const result = exactMatches[0];
        logger.info(`Found exact year match: '${result.name}' (${result.first_air_date})`);
        return result;
      }
    }

    // Return the first (highest rated) result
    const result = results[0];
    logger.info(`Using best match: '${result.name}' (${result.first_air_date}) - ID: ${result.id}`);
    return result;
  }

  async getEpisodeInfo(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    episodeTitle?: string,
    useEpisodeTitle: boolean = false,
  ): Promise<Record<string, any> | null> {
    try {
      if (useEpisodeTitle && episodeTitle) {
        return await this.getTvEpisodeDetails(tmdbId, seasonNumber, episodeNumber, episodeTitle);
      } else {
        return await this.getTvEpisodeDetails(tmdbId, seasonNumber, episodeNumber);
      }
    } catch (error) {
      const errorStr = String(error).toLowerCase();
      if (errorStr.includes('404') || errorStr.includes('not found')) {
        logger.warning(
          `Episode S${seasonNumber}E${episodeNumber} not found for show ID ${tmdbId} in TMDb`,
        );
        return null;
      }
      logger.error(`TMDb API error fetching episode S${seasonNumber}E${episodeNumber}: ${error}`);
      throw error;
    }
  }
}
