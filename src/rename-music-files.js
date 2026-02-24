#!/usr/bin/env node
"use strict";
/**
 * Music file organizer for Plex using metadata sources like MusicBrainz.
 *
 * Organizes music files into Plex-friendly structure:
 * - Music/<Artist>/<Album>/<Title>.ext
 * - Music/<Artist>/<Album (Year)>/<Album> - <Track> - <Title>.ext
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
const logger = (0, logger_1.getLogger)();
class MusicOrganizer {
    constructor(dryRun = false, logLevel = constants_1.DEFAULT_LOG_LEVEL, recursive = true) {
        (0, logger_1.setupLogging)(logLevel);
        this.dryRun = dryRun;
        this.recursive = recursive;
        this.libraryRoot = path_1.default.resolve(constants_1.MEDIA_BASE_FOLDER, '..', 'music');
        this.destinationRoot = path_1.default.join(this.libraryRoot, constants_1.ORGANIZED_FOLDER);
        this.running = false;
    }
    /**
     * Scans music files in the queue folder and organizes them.
     */
    async organize() {
        if (this.running) {
            logger.warn('Organization already in progress, aborting duplicate run.');
            return;
        }
        this.running = true;
        try {
            const queueFolder = path_1.default.join(this.libraryRoot, constants_1.QUEUE_FOLDER);
            if (!fs_1.default.existsSync(queueFolder)) {
                logger.info(`Queue folder does not exist: ${queueFolder}`);
                logger.info('Nothing to organize.');
                return;
            }
            logger.info(`Starting music organization from: ${queueFolder}`);
            logger.info(`Destination: ${this.destinationRoot}`);
            if (this.dryRun) {
                logger.info('🔍 DRY RUN MODE - Files will NOT be moved');
            }
            const musicFiles = (0, file_manager_1.scanMediaFiles)(queueFolder, this.recursive, [
                '.mp3',
                '.flac',
                '.aac',
                '.ogg',
                '.wav',
                '.alac',
            ]);
            logger.info(`Found ${musicFiles.length} music files to process`);
            if (musicFiles.length === 0) {
                logger.info('No music files to organize.');
                return;
            }
            let organized = 0, skipped = 0, failed = 0;
            for (const file of musicFiles) {
                try {
                    const result = await this.processFile(file);
                    if (result === 'organized')
                        organized++;
                    else if (result === 'skipped')
                        skipped++;
                    else
                        failed++;
                }
                catch (error) {
                    logger.error(`Error processing ${file}: ${error}`);
                    failed++;
                }
            }
            logger.info(`\n📊 Organization Summary:`);
            logger.info(`✅ Organized: ${organized}`);
            logger.info(`⏭️  Skipped: ${skipped}`);
            logger.info(`❌ Failed: ${failed}`);
        }
        catch (error) {
            logger.error(`Fatal error during organization: ${error}`);
            throw error;
        }
        finally {
            this.running = false;
        }
    }
    /**
     * Processes a single music file.
     * Note: Actual metadata parsing and path construction to be implemented
     * with MusicBrainz or similar service.
     */
    async processFile(file) {
        // TODO: Implement music file metadata parsing
        // TODO: Query MusicBrainz or similar service for metadata
        // TODO: Construct Plex-friendly path: Music/<Artist>/<Album>/<Title>
        // TODO: Move file to organized location
        logger.debug(`Processing: ${file}`);
        // Placeholder: currently skip all files
        return 'skipped';
    }
}
const program = new commander_1.Command();
program
    .name('plex-music-organizer')
    .description('Organize music files for Plex using metadata sources')
    .version('1.0.0')
    .option('--dry-run', 'Preview changes without moving files', false)
    .option('--log-level <level>', 'Set logging level (DEBUG, INFO, WARN, ERROR)', constants_1.DEFAULT_LOG_LEVEL)
    .option('--no-recursive', 'Do not recursively scan subdirectories', true)
    .action(async (options) => {
    try {
        const organizer = new MusicOrganizer(options.dryRun, options.logLevel, options.recursive);
        await organizer.organize();
    }
    catch (error) {
        logger.error(`Application error: ${error}`);
        process.exit(1);
    }
});
program.parse(process.argv);
