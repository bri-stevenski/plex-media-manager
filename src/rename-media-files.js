#!/usr/bin/env node
"use strict";
/**
 * TMDb-driven media organizer for Plex.
 *
 * Organizes files into Plex-friendly structure:
 * - Movies/<Title (Year) {tmdb-id}>/<Title (Year) {tmdb-id}>.ext
 * - TV Shows/<Show (Year) {tmdb-id}>/Season XX/<Show (Year) - sXXeYY - Episode.ext
 * - TV Shows/<Show (Year) {tmdb-id}>/Season XX/<Show (Year) - YYYY-MM-DD - Episode.ext
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const commander_1 = require("commander");
const constants_1 = require("./utils/constants");
const file_manager_1 = require("./utils/file-manager");
const logger_1 = require("./utils/logger");
const parser_1 = require("./utils/parser");
const formatter_1 = require("./utils/formatter");
const tmdb_client_1 = require("./utils/tmdb-client");
const logger = (0, logger_1.getLogger)();
class MediaRenamer {
    constructor(dryRun = false, logLevel = constants_1.DEFAULT_LOG_LEVEL, recursive = true, useEpisodeTitles = false, libraryRoot = constants_1.MEDIA_BASE_FOLDER, outputSubfolder = constants_1.ORGANIZED_FOLDER) {
        this.dryRun = dryRun;
        this.recursive = recursive;
        this.useEpisodeTitles = useEpisodeTitles;
        this.libraryRoot = path_1.default.resolve(libraryRoot);
        this.destinationRoot = path_1.default.resolve(this.libraryRoot, outputSubfolder);
        this.running = true;
        (0, logger_1.setupLogging)(logLevel, constants_1.LOG_DIR, true);
        this.tmdbClient = new tmdb_client_1.TMDbClient();
        process.on('SIGINT', () => this.handleShutdown());
        process.on('SIGTERM', () => this.handleShutdown());
        logger.info('Media Renamer initialized', {
            dry_run: dryRun,
            recursive,
            use_episode_titles: useEpisodeTitles,
            library_root: this.libraryRoot,
            destination_root: this.destinationRoot,
        });
    }
    handleShutdown() {
        logger.info('Received shutdown signal, exiting gracefully...');
        this.running = false;
        process.exit(0);
    }
    async run(sourceDir) {
        const sourceRoot = path_1.default.resolve(sourceDir);
        if (!fs_1.default.existsSync(sourceRoot) || !fs_1.default.statSync(sourceRoot).isDirectory()) {
            throw new Error(`Source directory not found: ${sourceRoot}`);
        }
        logger.info(`Starting TMDb organization from: ${sourceRoot}`);
        let totalFilesProcessed = 0;
        let organized = 0;
        let skipped = 0;
        let failed = 0;
        for (const filepath of (0, file_manager_1.scanMediaFiles)(sourceRoot, this.recursive)) {
            if (!this.running) {
                break;
            }
            totalFilesProcessed++;
            const result = await this.processFile(filepath);
            if (result === 'organized') {
                organized++;
            }
            else if (result === 'skipped') {
                skipped++;
            }
            else {
                failed++;
            }
        }
        const modePrefix = this.dryRun ? 'DRY RUN COMPLETE -' : 'Organization complete -';
        logger.info(`${modePrefix} Total: ${totalFilesProcessed}, Organized: ${organized}, Skipped: ${skipped}, Failed: ${failed}`);
    }
    async processFile(filepath) {
        logger.info(`Processing file: ${filepath}`);
        try {
            if (this.shouldSkipSupplementalFile(filepath)) {
                logger.info(`Skipping supplemental file: ${filepath}`);
                return 'skipped';
            }
            const mediaInfo = (0, parser_1.parseMediaFile)(filepath);
            logger.debug('Parsed media info', {
                filepath: filepath.split(/[\\/]/).pop(),
                content_type: mediaInfo.content_type,
                title: mediaInfo.title,
                year: mediaInfo.year,
            });
            const tmdbData = await this.lookupTmdbMetadata(mediaInfo);
            if (!tmdbData) {
                const reason = mediaInfo.content_type === constants_1.CONTENT_TYPE_MOVIES
                    ? `No movie match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`
                    : `No TV show match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`;
                logger.warning(`Skipping file: ${reason}`, {
                    filepath: filepath.split(/[\\/]/).pop(),
                    lookup_type: mediaInfo.content_type,
                    title: mediaInfo.title,
                });
                return 'failed';
            }
            if (mediaInfo.content_type !== constants_1.CONTENT_TYPE_MOVIES) {
                await this.enrichEpisodeMetadata(mediaInfo, tmdbData);
            }
            const destinationPath = this.buildDestinationPath(filepath, mediaInfo, tmdbData);
            if (!destinationPath) {
                logger.warning(`Could not build destination path, skipping: ${filepath}`);
                return 'skipped';
            }
            return this.moveToDestination(filepath, destinationPath);
        }
        catch (error) {
            logger.error(`Failed to process file ${filepath}: ${error}`);
            return 'failed';
        }
    }
    shouldSkipSupplementalFile(filepath) {
        const segments = path_1.default
            .normalize(filepath)
            .split(path_1.default.sep)
            .map((segment) => segment.toLowerCase());
        const supplementalSegments = [
            'featurettes',
            'extras',
            'bonus',
            'bonus features',
            'behind the scenes',
            'deleted scenes',
            'trailers',
            'samples',
        ];
        return supplementalSegments.some((name) => segments.includes(name));
    }
    async lookupTmdbMetadata(mediaInfo) {
        const cleanTitle = (mediaInfo.title || '').trim();
        if (!cleanTitle) {
            logger.warning('Parsed title is empty; cannot query TMDb');
            return null;
        }
        if (mediaInfo.content_type === constants_1.CONTENT_TYPE_MOVIES) {
            return this.tmdbClient.findBestMovieMatch(cleanTitle, mediaInfo.year || undefined);
        }
        return this.tmdbClient.findBestTvMatch(cleanTitle, mediaInfo.year || undefined, this.useEpisodeTitles);
    }
    async enrichEpisodeMetadata(mediaInfo, tmdbData) {
        if (!tmdbData.id) {
            return;
        }
        if (mediaInfo.date_str) {
            try {
                const dateEpisodeData = await this.tmdbClient.getEpisodeByAirDate(tmdbData.id, mediaInfo.date_str);
                if (dateEpisodeData) {
                    if (typeof dateEpisodeData.name === 'string' && dateEpisodeData.name.trim().length > 0) {
                        mediaInfo.episode_title = dateEpisodeData.name.trim();
                    }
                    if (typeof dateEpisodeData.season_number === 'number') {
                        mediaInfo.season = dateEpisodeData.season_number;
                    }
                    if (typeof dateEpisodeData.episode_number === 'number') {
                        mediaInfo.episode = dateEpisodeData.episode_number;
                    }
                    return;
                }
            }
            catch (error) {
                logger.warning(`TMDb air-date episode lookup failed for ${mediaInfo.title}: ${error}`);
            }
        }
        if (mediaInfo.season === null || mediaInfo.episode === null) {
            return;
        }
        try {
            const episodeData = await this.tmdbClient.getEpisodeInfo(tmdbData.id, mediaInfo.season, mediaInfo.episode, mediaInfo.episode_title || undefined, this.useEpisodeTitles);
            if (!episodeData) {
                return;
            }
            if (typeof episodeData.name === 'string' && episodeData.name.trim().length > 0) {
                mediaInfo.episode_title = episodeData.name.trim();
            }
            if (typeof episodeData.season_number === 'number') {
                mediaInfo.season = episodeData.season_number;
            }
            if (typeof episodeData.episode_number === 'number') {
                mediaInfo.episode = episodeData.episode_number;
            }
        }
        catch (error) {
            logger.warning(`TMDb episode enrichment failed for ${mediaInfo.title}: ${error}`);
        }
    }
    buildDestinationPath(filepath, mediaInfo, tmdbData) {
        const tmdbId = Number(tmdbData.id);
        if (!Number.isFinite(tmdbId)) {
            logger.error(`Invalid TMDb ID in result: ${JSON.stringify(tmdbData)}`);
            return null;
        }
        const extension = path_1.default.extname(filepath);
        if (mediaInfo.content_type === constants_1.CONTENT_TYPE_MOVIES) {
            const movieTitle = String(tmdbData.title || mediaInfo.title || '').trim();
            const tmdbYear = this.extractYear(tmdbData.release_date);
            let movieYear = tmdbYear || mediaInfo.year;
            if (mediaInfo.year && tmdbYear && Math.abs(mediaInfo.year - tmdbYear) > 1) {
                logger.warning(`Movie year mismatch for '${movieTitle}': parsed ${mediaInfo.year}, TMDb ${tmdbYear}. Using parsed year for naming.`);
                movieYear = mediaInfo.year;
            }
            if (!movieTitle || !movieYear) {
                logger.warning(`Missing movie title/year for ${filepath}`);
                return null;
            }
            return (0, formatter_1.constructMoviePath)(movieTitle, movieYear, tmdbId, extension, this.destinationRoot);
        }
        const seriesTitle = String(tmdbData.name || mediaInfo.title || '').trim();
        const seriesYear = this.extractYear(tmdbData.first_air_date) || mediaInfo.year;
        if (!seriesTitle) {
            logger.warning(`Missing series title for TV file: ${filepath}`);
            return null;
        }
        if (mediaInfo.date_str) {
            const seasonForFolder = mediaInfo.season ?? 1;
            return (0, formatter_1.constructTvShowDatePath)(seriesTitle, seriesYear || null, tmdbId, seasonForFolder, mediaInfo.date_str, mediaInfo.episode_title, extension, this.destinationRoot);
        }
        if (mediaInfo.season === null || mediaInfo.episode === null) {
            logger.warning(`Missing season/episode info for TV file: ${filepath}`);
            return null;
        }
        const episodeStr = String(mediaInfo.episode).padStart(2, '0');
        const episodeTitle = mediaInfo.episode_title || `Episode ${episodeStr}`;
        return (0, formatter_1.constructTvShowPath)(seriesTitle, seriesYear || null, tmdbId, mediaInfo.season, mediaInfo.episode, episodeTitle, extension, this.destinationRoot);
    }
    moveToDestination(sourcePath, destinationPath) {
        if (this.areSamePath(sourcePath, destinationPath)) {
            logger.debug(`Already organized: ${sourcePath}`);
            return 'skipped';
        }
        if (fs_1.default.existsSync(destinationPath)) {
            logger.error(`Destination already exists: ${destinationPath}`);
            return 'failed';
        }
        const sourceName = path_1.default.basename(sourcePath);
        const destinationRelative = path_1.default.relative(this.libraryRoot, destinationPath);
        if (this.dryRun) {
            logger.info(`DRY RUN: ${sourceName} -> ${destinationRelative}`);
            return 'organized';
        }
        const success = (0, file_manager_1.safeMove)(sourcePath, destinationPath);
        if (!success) {
            logger.error(`Move failed: ${sourcePath} -> ${destinationPath}`);
            return 'failed';
        }
        logger.info(`Moved: ${sourceName} -> ${destinationRelative}`);
        return 'organized';
    }
    extractYear(dateLike) {
        if (typeof dateLike !== 'string') {
            return null;
        }
        const match = /^(\d{4})/.exec(dateLike.trim());
        if (!match) {
            return null;
        }
        const parsed = Number(match[1]);
        if (parsed < 1900 || parsed > 2099) {
            return null;
        }
        return parsed;
    }
    areSamePath(left, right) {
        const a = path_1.default.resolve(left);
        const b = path_1.default.resolve(right);
        if (process.platform === 'win32') {
            return a.toLowerCase() === b.toLowerCase();
        }
        return a === b;
    }
}
async function main() {
    const program = new commander_1.Command();
    program
        .name('media-renamer')
        .description('TMDb-based media organizer for Plex naming and folder conventions')
        .argument('[source_dir]', 'Source directory to scan. Defaults to <library_root>/queue if omitted.')
        .option('--dry-run', 'Preview changes without making modifications')
        .option('--no-recursive', 'Only scan source_dir, not nested directories')
        .option('--use-episode-titles', 'Use parsed episode titles to help TMDb identify correct episode numbers')
        .option('--library-root <path>', 'Root media folder that contains source and destination media folders', constants_1.MEDIA_BASE_FOLDER)
        .option('--output-subfolder <name>', 'Subfolder under library-root where organized files are written', constants_1.ORGANIZED_FOLDER)
        .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', constants_1.DEFAULT_LOG_LEVEL)
        .action(async (sourceDir, options) => {
        const libraryRoot = path_1.default.resolve(options.libraryRoot || constants_1.MEDIA_BASE_FOLDER);
        const resolvedSource = sourceDir
            ? path_1.default.resolve(sourceDir)
            : path_1.default.join(libraryRoot, constants_1.QUEUE_FOLDER);
        const renamer = new MediaRenamer(options.dryRun || false, options.logLevel, options.recursive !== false, options.useEpisodeTitles || false, libraryRoot, options.outputSubfolder || constants_1.ORGANIZED_FOLDER);
        try {
            await renamer.run(resolvedSource);
        }
        catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
        }
    });
    program.parse(process.argv);
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
