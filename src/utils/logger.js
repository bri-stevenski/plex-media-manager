"use strict";
/**
 * Structured logging system for the Plex media tool using Winston.
 *
 * This module provides a centralized logging system with:
 * - Color-coded console output
 * - JSON file logging
 * - Structured log entries
 * - Multiple log levels
 * - File rotation capabilities
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexLogger = void 0;
exports.setupLogging = setupLogging;
exports.getLogger = getLogger;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const winston_1 = __importDefault(require("winston"));
const constants_1 = require("./constants");
class PlexLogger {
    constructor(name = 'plex-media-tool', logLevel = constants_1.DEFAULT_LOG_LEVEL, logDir, enableConsole = true) {
        this.name = name;
        this.logLevel = logLevel.toUpperCase();
        const actualLogDir = logDir || constants_1.LOG_DIR;
        // Create log directory if it doesn't exist
        if (!fs_1.default.existsSync(actualLogDir)) {
            fs_1.default.mkdirSync(actualLogDir, { recursive: true });
        }
        // Generate timestamped log filename
        const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
        const logFile = path_1.default.join(actualLogDir, `${name}_${timestamp}.log`);
        // Create custom format for console with colors
        const consoleFormat = winston_1.default.format.combine(winston_1.default.format.colorize({ all: true }), winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 0) : '';
            return `${timestamp} ${level}: ${message}${metaStr ? ' ' + metaStr : ''}`;
        }));
        // Create custom format for file (JSON)
        const fileFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston_1.default.format.json(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const entry = {
                timestamp: String(timestamp),
                level: String(level),
                logger: this.name,
                message: String(message),
                module: 'plex-media-tool',
                ...meta,
            };
            return JSON.stringify(entry);
        }));
        const transports = [
            new winston_1.default.transports.File({
                filename: logFile,
                format: fileFormat,
                level: this.logLevel.toLowerCase(),
            }),
        ];
        if (enableConsole) {
            transports.push(new winston_1.default.transports.Console({
                format: consoleFormat,
                level: this.logLevel.toLowerCase(),
            }));
        }
        this.winstonLogger = winston_1.default.createLogger({
            level: this.logLevel.toLowerCase(),
            transports,
            exitOnError: false,
        });
    }
    debug(message, extra) {
        this.winstonLogger.debug(message, extra);
    }
    info(message, extra) {
        this.winstonLogger.info(message, extra);
    }
    warning(message, extra) {
        this.winstonLogger.warn(message, extra);
    }
    error(message, extra) {
        this.winstonLogger.error(message, extra);
    }
}
exports.PlexLogger = PlexLogger;
// Global logger instance
let globalLogger = null;
function setupLogging(logLevel = constants_1.DEFAULT_LOG_LEVEL, logDir, enableConsole = true) {
    globalLogger = new PlexLogger('plex-media-tool', logLevel, logDir, enableConsole);
    return globalLogger;
}
function getLogger() {
    if (!globalLogger) {
        globalLogger = setupLogging();
    }
    return globalLogger;
}
