"use strict";
/**
 * File manager for handling media file operations.
 *
 * This module provides functions for scanning, moving, copying, and organizing
 * media files throughout the processing pipeline.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanMediaFiles = scanMediaFiles;
exports.safeMove = safeMove;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const logger = (0, logger_1.getLogger)();
class FileOperationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FileOperationError';
    }
}
/**
 * Move a file from source to destination.
 */
function moveFile(source, destination, createDirs = true) {
    if (!fs_1.default.existsSync(source)) {
        throw new FileOperationError(`Source file does not exist: ${source}`);
    }
    if (createDirs) {
        ensureDirectoryExists(path_1.default.dirname(destination));
    }
    try {
        fs_1.default.renameSync(source, destination);
        logger.debug(`Moved file: ${source} -> ${destination}`);
        return;
    }
    catch (error) {
        const nodeError = error;
        if (nodeError?.code === 'EXDEV') {
            // Cross-device rename (different drive/mount), fallback to copy + delete.
            try {
                fs_1.default.copyFileSync(source, destination);
                fs_1.default.unlinkSync(source);
                logger.debug(`Moved file via copy+delete: ${source} -> ${destination}`);
                return;
            }
            catch (copyError) {
                throw new FileOperationError(`Failed cross-device move ${source} to ${destination}: ${copyError}`);
            }
        }
        throw new FileOperationError(`Failed to move file ${source} to ${destination}: ${error}`);
    }
}
/**
 * Scan a directory for media files.
 */
function* scanMediaFiles(directory, recursive = true) {
    if (!fs_1.default.existsSync(directory)) {
        logger.warning(`Directory does not exist: ${directory}`);
        return;
    }
    if (!fs_1.default.statSync(directory).isDirectory()) {
        logger.error(`Path is not a directory: ${directory}`);
        return;
    }
    const scanDir = function* (dir) {
        const files = fs_1.default.readdirSync(dir);
        for (const file of files) {
            const filepath = path_1.default.join(dir, file);
            const stats = fs_1.default.statSync(filepath);
            if (stats.isFile()) {
                const ext = path_1.default.extname(filepath).toLowerCase();
                if (constants_1.VIDEO_EXTENSIONS.has(ext)) {
                    yield filepath;
                }
            }
            else if (stats.isDirectory() && recursive) {
                yield* scanDir(filepath);
            }
        }
    };
    yield* scanDir(directory);
}
/**
 * Ensure a directory exists, creating it if necessary.
 */
function ensureDirectoryExists(directory) {
    try {
        if (!fs_1.default.existsSync(directory)) {
            fs_1.default.mkdirSync(directory, { recursive: true });
        }
        logger.debug(`Ensured directory exists: ${directory}`);
    }
    catch (error) {
        throw new FileOperationError(`Failed to create directory ${directory}: ${error}`);
    }
}
/**
 * Safely move a file with error handling and backup.
 */
function safeMove(source, destination, errorDir) {
    try {
        // Validate source file exists before moving
        if (!fs_1.default.existsSync(source)) {
            logger.error(`Source file does not exist: ${source}`);
            return false;
        }
        const sourceSize = fs_1.default.statSync(source).size;
        moveFile(source, destination);
        // Verify the move was successful
        if (!fs_1.default.existsSync(destination)) {
            logger.error(`Destination file does not exist after move: ${destination}`);
            return false;
        }
        if (fs_1.default.existsSync(source)) {
            logger.error(`Source file still exists after move (incomplete operation): ${source}`);
            return false;
        }
        // Verify destination file has expected size
        const destSize = fs_1.default.statSync(destination).size;
        if (sourceSize !== destSize) {
            logger.error(`File size mismatch after move. Expected ${sourceSize}, got ${destSize}: ${destination}`);
            return false;
        }
        logger.debug(`Successfully verified move of ${path_1.default.basename(source)}`);
        return true;
    }
    catch (error) {
        logger.error(`Failed to move file ${source}: ${error}`);
        if (errorDir) {
            try {
                ensureDirectoryExists(errorDir);
                const errorDestination = path_1.default.join(errorDir, path_1.default.basename(source));
                moveFile(source, errorDestination);
                logger.warning(`Moved failed file to error directory: ${errorDestination}`);
                return false;
            }
            catch (backupError) {
                logger.error(`Failed to move file to error directory: ${backupError}`);
            }
        }
        return false;
    }
}
