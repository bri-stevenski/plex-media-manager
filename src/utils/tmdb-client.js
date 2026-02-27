"use strict";
/**
 * TMDb API client for fetching movie and TV show metadata.
 *
 * This module provides a clean interface to The Movie Database API,
 * handling search requests, error handling, and response parsing.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TMDbClient = exports.TMDbAPIError = exports.TMDbError = void 0;
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const logger = (0, logger_1.getLogger)();
class TMDbError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TMDbError';
    }
}
exports.TMDbError = TMDbError;
class TMDbAPIError extends TMDbError {
    constructor(message) {
        super(message);
        this.name = 'TMDbAPIError';
    }
}
exports.TMDbAPIError = TMDbAPIError;
class TMDbClient {
    constructor(apiKey) {
        this.lastRequestTime = 0;
        this.MIN_REQUEST_INTERVAL = 250; // Minimum 250ms between requests to respect rate limits
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second between retries
        this.apiKey = apiKey || constants_1.TMDB_API_KEY;
        if (!this.apiKey) {
            throw new TMDbError('TMDb API key is required. Set TMDB_API_KEY environment variable.');
        }
        this.baseUrl = constants_1.TMDB_BASE_URL;
        this.session = axios_1.default.create({
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
    async makeRequest(endpoint, params) {
        const url = `/${endpoint.replace(/^\//, '')}`;
        // Rate limiting: ensure minimum interval between requests
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
            await new Promise((resolve) => setTimeout(resolve, this.MIN_REQUEST_INTERVAL - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
        // Retry logic for transient failures
        let lastError;
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                logger.debug(`TMDb API request: ${url} (attempt ${attempt}/${this.MAX_RETRIES})`);
                if (params) {
                    const safeParams = { ...params };
                    delete safeParams.api_key;
                    logger.debug(`Request params: ${JSON.stringify(safeParams)}`);
                }
                const response = await this.session.get(url, { params });
                const data = response.data;
                if (data.success === false) {
                    logger.error(`TMDb API error: ${data.status_message || 'Unknown error'}`);
                    throw new TMDbAPIError(`TMDb API error: ${data.status_message || 'Unknown error'}`);
                }
                if (data.results) {
                    logger.debug(`TMDb response: ${data.results.length} results found`);
                }
                else {
                    logger.debug('TMDb response: success');
                }
                return data;
            }
            catch (error) {
                lastError = error;
                // Check if error is retryable (timeout, connection error, 429 rate limit)
                const isRetryable = axios_1.default.isAxiosError(error) &&
                    (error.code === 'ECONNABORTED' || // Timeout
                        error.code === 'ECONNREFUSED' || // Connection refused
                        error.code === 'ETIMEDOUT' || // Timeout
                        error.response?.status === 429 || // Rate limit
                        error.response?.status === 500 || // Server error
                        error.response?.status === 502 || // Bad gateway
                        error.response?.status === 503); // Service unavailable
                if (!isRetryable || attempt === this.MAX_RETRIES) {
                    if (axios_1.default.isAxiosError(error)) {
                        logger.error(`TMDb request failed: ${error.message}`);
                        throw new TMDbAPIError(`Request failed: ${error.message}`);
                    }
                    throw error;
                }
                // Wait before retrying
                const delayMs = this.RETRY_DELAY * attempt; // Exponential backoff
                logger.warning(`TMDb request failed (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}. Retrying in ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        throw lastError;
    }
    async searchMovie(title, year) {
        const cacheKey = `${title}:${year || 'any'}`;
        // Check cache first
        if (this.movieSearchCache.has(cacheKey)) {
            logger.debug(`Cache hit for movie search: '${title}' (${year || 'any year'})`);
            return this.movieSearchCache.get(cacheKey);
        }
        const params = { query: title };
        if (year) {
            params.year = String(year);
        }
        logger.info(`Searching TMDb for movie: '${title}' (${year || 'any year'})`);
        const data = await this.makeRequest('search/movie', params);
        const results = data.results || [];
        logger.info(`TMDb returned ${results.length} movie results`);
        if (results.length > 0) {
            logger.debug('Top TMDb movie results:');
            results.slice(0, 3).forEach((result, i) => {
                logger.debug(`  ${i + 1}. ${result.title} (${result.release_date || 'Unknown'}) - ID: ${result.id}`);
            });
        }
        else {
            logger.warning(`No TMDb movie results found for: '${title}' (${year || 'any year'})`);
        }
        // Store in cache
        this.movieSearchCache.set(cacheKey, results);
        return results;
    }
    async searchTvShow(title, firstAirDateYear) {
        const cacheKey = `${title}:${firstAirDateYear || 'any'}`;
        // Check cache first
        if (this.tvShowSearchCache.has(cacheKey)) {
            logger.debug(`Cache hit for TV show search: '${title}' (${firstAirDateYear || 'any year'})`);
            return this.tvShowSearchCache.get(cacheKey);
        }
        const params = { query: title };
        if (firstAirDateYear) {
            params.first_air_date_year = String(firstAirDateYear);
        }
        logger.info(`Searching TMDb for TV show: '${title}' (${firstAirDateYear || 'any year'})`);
        const data = await this.makeRequest('search/tv', params);
        const results = data.results || [];
        logger.info(`TMDb returned ${results.length} TV show results`);
        if (results.length > 0) {
            logger.debug('Top TMDb TV results:');
            results.slice(0, 3).forEach((result, i) => {
                logger.debug(`  ${i + 1}. ${result.name} (${result.first_air_date || 'Unknown'}) - ID: ${result.id}`);
            });
        }
        else {
            logger.warning(`No TMDb TV results found for: '${title}' (${firstAirDateYear || 'any year'})`);
        }
        // Store in cache
        this.tvShowSearchCache.set(cacheKey, results);
        return results;
    }
    async getMovieDetails(tmdbId) {
        logger.debug(`Getting movie details for ID: ${tmdbId}`);
        return this.makeRequest(`movie/${tmdbId}`);
    }
    async getTvShowDetails(tmdbId) {
        logger.debug(`Getting TV show details for ID: ${tmdbId}`);
        return this.makeRequest(`tv/${tmdbId}`);
    }
    async getTvEpisodeDetails(tmdbId, seasonNumber, episodeNumber, episodeTitle) {
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
                        logger.debug(`Found episode '${episodeTitle}' as S${seasonNumber}E${finalEpisodeNumber}`);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    logger.error(`Episode titled '${episodeTitle}' not found in season ${seasonNumber} of show ID ${tmdbId}, searching other seasons...`);
                    const tvData = await this.getTvShowDetails(tmdbId);
                    const seasons = tvData.seasons || [];
                    // Limit search to recent seasons to avoid excessive API calls
                    // Search in reverse chronological order (most recent first)
                    const recentSeasons = seasons
                        .filter((s) => (s.season_number || 0) > 0) // Skip season 0 (specials) unless specifically requested
                        .sort((a, b) => (b.season_number || 0) - (a.season_number || 0))
                        .slice(0, 5); // Limit to last 5 seasons
                    for (const season of recentSeasons) {
                        const seasonNum = season.season_number;
                        try {
                            const seasonDataSearch = await this.makeRequest(`tv/${tmdbId}/season/${seasonNum}`);
                            const episodesSearch = seasonDataSearch.episodes || [];
                            for (const episode of episodesSearch) {
                                if (episode.name?.toLowerCase() === episodeTitle.toLowerCase()) {
                                    finalEpisodeNumber = episode.episode_number;
                                    finalSeasonNumber = seasonNum;
                                    logger.debug(`Found episode '${episodeTitle}' as S${finalSeasonNumber}E${finalEpisodeNumber}`);
                                    found = true;
                                    break;
                                }
                            }
                            if (found)
                                break;
                        }
                        catch (seasonError) {
                            logger.warning(`Failed to search season ${seasonNum}: ${seasonError}`);
                            // Continue searching other seasons
                        }
                    }
                    if (!found) {
                        logger.warning(`Episode titled '${episodeTitle}' not found in any recent season of show ID ${tmdbId}`);
                    }
                }
            }
            catch (error) {
                logger.error(`Error searching for episode by title: ${error}`);
            }
        }
        logger.debug(`Getting episode details for show ID ${tmdbId}, S${finalSeasonNumber}E${finalEpisodeNumber}`);
        const episodeData = await this.makeRequest(`tv/${tmdbId}/season/${finalSeasonNumber}/episode/${finalEpisodeNumber}`);
        // Include the corrected season and episode numbers in the response
        episodeData.season_number = finalSeasonNumber;
        episodeData.episode_number = finalEpisodeNumber;
        return episodeData;
    }
    async findBestMovieMatch(title, year) {
        let results = await this.searchMovie(title, year);
        if (results.length === 0) {
            logger.warning(`No TMDb results found for movie: '${title}' (${year || 'any year'})`);
            // Try alternative search without year
            if (year) {
                logger.info(`Retrying movie search without year filter: '${title}'`);
                results = await this.searchMovie(title);
                if (results.length > 0) {
                    const result = results[0];
                    logger.info(`Using best match (no year): '${result.title}' (${result.release_date}) - ID: ${result.id}`);
                    return result;
                }
            }
            return null;
        }
        const scored = results
            .map((result) => ({
            result,
            score: this.scoreMovieResult(title, year, result),
        }))
            .sort((a, b) => b.score - a.score);
        const result = scored[0]?.result ?? null;
        if (!result) {
            return null;
        }
        logger.info(`Using best movie match: '${result.title}' (${result.release_date}) - ID: ${result.id} (score: ${scored[0]?.score.toFixed(2)})`);
        return result;
    }
    normalizeTitleForScoring(value) {
        return value
            .toLowerCase()
            .replace(/['\u2019:`]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    extractYear(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const match = /^(\d{4})/.exec(value.trim());
        if (!match || !match[1]) {
            return null;
        }
        return parseInt(match[1]);
    }
    scoreMovieTitleSimilarity(queryTitle, candidateTitle) {
        const normalizedQuery = this.normalizeTitleForScoring(queryTitle);
        const normalizedCandidate = this.normalizeTitleForScoring(candidateTitle);
        if (!normalizedQuery || !normalizedCandidate) {
            return 0;
        }
        if (normalizedQuery === normalizedCandidate) {
            return 1;
        }
        const queryTokens = new Set(normalizedQuery.split(' ').filter(Boolean));
        const candidateTokens = new Set(normalizedCandidate.split(' ').filter(Boolean));
        if (queryTokens.size === 0 || candidateTokens.size === 0) {
            return 0;
        }
        let overlap = 0;
        for (const token of queryTokens) {
            if (candidateTokens.has(token)) {
                overlap++;
            }
        }
        const precision = overlap / queryTokens.size;
        const recall = overlap / candidateTokens.size;
        const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
        const containsBoost = normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)
            ? 0.15
            : 0;
        return Math.min(1, f1 + containsBoost);
    }
    scoreMovieResult(queryTitle, queryYear, result) {
        const candidateTitle = typeof result.title === 'string'
            ? result.title
            : typeof result.original_title === 'string'
                ? result.original_title
                : '';
        const titleSimilarity = this.scoreMovieTitleSimilarity(queryTitle, candidateTitle);
        let score = titleSimilarity * 100;
        if (queryYear) {
            const releaseYear = this.extractYear(result.release_date);
            if (releaseYear !== null) {
                const yearDiff = Math.abs(releaseYear - queryYear);
                if (yearDiff === 0) {
                    score += 15;
                }
                else if (yearDiff === 1) {
                    score += 8;
                }
                else if (yearDiff === 2) {
                    score += 3;
                }
                else if (yearDiff >= 10) {
                    score -= 10;
                }
            }
        }
        const popularity = typeof result.popularity === 'number' && Number.isFinite(result.popularity)
            ? result.popularity
            : 0;
        const voteCount = typeof result.vote_count === 'number' && Number.isFinite(result.vote_count)
            ? result.vote_count
            : 0;
        score += Math.min(popularity, 100) / 100;
        score += Math.min(voteCount, 500) / 500;
        return score;
    }
    async findBestTvMatch(title, year, _useEpisodeTitles = false) {
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
                        logger.info(`Found match with alternative title: '${result.name}' (${result.first_air_date}) - ID: ${result.id}`);
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
                    logger.info(`Using best match (no year): '${result.name}' (${result.first_air_date}) - ID: ${result.id}`);
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
    normalizeAirDate(dateValue) {
        const trimmed = dateValue.trim();
        let match = /^(\d{4})[-_. ](0[1-9]|1[0-2])[-_. ](0[1-9]|[12]\d|3[01])$/.exec(trimmed);
        if (match) {
            return `${match[1]}-${match[2]}-${match[3]}`;
        }
        match = /^(0[1-9]|[12]\d|3[01])[-_. ](0[1-9]|1[0-2])[-_. ](\d{4})$/.exec(trimmed);
        if (match) {
            return `${match[3]}-${match[2]}-${match[1]}`;
        }
        return null;
    }
    async getEpisodeByAirDate(tmdbId, airDate) {
        const normalizedAirDate = this.normalizeAirDate(airDate);
        if (!normalizedAirDate) {
            logger.warning(`Could not normalize air date '${airDate}' for TMDb lookup`);
            return null;
        }
        logger.debug(`Looking up episode for show ID ${tmdbId} by air date ${normalizedAirDate}`);
        try {
            const showData = await this.getTvShowDetails(tmdbId);
            const seasons = Array.isArray(showData.seasons)
                ? showData.seasons
                : [];
            const targetYear = parseInt(normalizedAirDate.substring(0, 4));
            const orderedSeasons = seasons
                .filter((season) => typeof season.season_number === 'number')
                .sort((a, b) => {
                const seasonANumber = Number(a.season_number);
                const seasonBNumber = Number(b.season_number);
                const seasonAYear = typeof a.air_date === 'string' ? parseInt(a.air_date.substring(0, 4)) : NaN;
                const seasonBYear = typeof b.air_date === 'string' ? parseInt(b.air_date.substring(0, 4)) : NaN;
                const priorityA = Number.isNaN(seasonAYear)
                    ? Number.MAX_SAFE_INTEGER
                    : Math.abs(seasonAYear - targetYear);
                const priorityB = Number.isNaN(seasonBYear)
                    ? Number.MAX_SAFE_INTEGER
                    : Math.abs(seasonBYear - targetYear);
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                return seasonANumber - seasonBNumber;
            });
            for (const season of orderedSeasons) {
                const seasonNumber = Number(season.season_number);
                try {
                    const seasonData = await this.makeRequest(`tv/${tmdbId}/season/${seasonNumber}`);
                    const episodes = Array.isArray(seasonData.episodes)
                        ? seasonData.episodes
                        : [];
                    const match = episodes.find((episode) => typeof episode.air_date === 'string' && episode.air_date === normalizedAirDate);
                    if (match) {
                        logger.info(`Found episode by air date ${normalizedAirDate}: S${seasonNumber}E${match.episode_number}`);
                        return {
                            ...match,
                            season_number: seasonNumber,
                        };
                    }
                }
                catch (seasonError) {
                    logger.warning(`Failed scanning season ${seasonNumber} for show ${tmdbId}: ${seasonError}`);
                }
            }
            logger.warning(`No episode found for show ID ${tmdbId} with air date ${normalizedAirDate}`);
            return null;
        }
        catch (error) {
            logger.error(`TMDb air-date lookup failed for show ${tmdbId}: ${error}`);
            return null;
        }
    }
    async getEpisodeInfo(tmdbId, seasonNumber, episodeNumber, episodeTitle, useEpisodeTitle = false) {
        try {
            if (useEpisodeTitle && episodeTitle) {
                return await this.getTvEpisodeDetails(tmdbId, seasonNumber, episodeNumber, episodeTitle);
            }
            else {
                return await this.getTvEpisodeDetails(tmdbId, seasonNumber, episodeNumber);
            }
        }
        catch (error) {
            const errorStr = String(error).toLowerCase();
            if (errorStr.includes('404') || errorStr.includes('not found')) {
                logger.warning(`Episode S${seasonNumber}E${episodeNumber} not found for show ID ${tmdbId} in TMDb`);
                return null;
            }
            logger.error(`TMDb API error fetching episode S${seasonNumber}E${episodeNumber}: ${error}`);
            throw error;
        }
    }
}
exports.TMDbClient = TMDbClient;
