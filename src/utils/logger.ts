/**
 * Structured logging system for the Plex media tool.
 *
 * This module provides a centralized logging system with JSON formatting,
 * multiple log levels, and file rotation capabilities.
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_LOG_LEVEL, LOG_DIR } from './constants';

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  module: string;
  function?: string;
  line?: number;
  [key: string]: any;
}

export class PlexLogger {
  private logLevel: string;
  private logDir: string;
  private logFile: string;
  private enableConsole: boolean;
  private name: string;

  constructor(
    name: string = 'plex-media-tool',
    logLevel: string = DEFAULT_LOG_LEVEL,
    logDir?: string,
    enableConsole: boolean = true,
  ) {
    this.name = name;
    this.logLevel = logLevel.toUpperCase();
    this.logDir = logDir || LOG_DIR;
    this.enableConsole = enableConsole;

    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Generate timestamped log filename
    const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
    this.logFile = path.join(this.logDir, `${name}_${timestamp}.log`);
  }

  private formatLogEntry(level: string, message: string, extra?: Record<string, any>): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      module: 'plex-media-tool',
    };

    if (extra) {
      Object.assign(entry, extra);
    }

    return entry;
  }

  private writeLog(logEntry: LogEntry): void {
    const logLine = JSON.stringify(logEntry) + '\n';

    // Write to console if enabled
    if (this.enableConsole) {
      const prefix = `${logEntry.timestamp} - ${logEntry.level}`;
      console.log(`${prefix}: ${logEntry.message}`);
    }

    // Write to file
    try {
      fs.appendFileSync(this.logFile, logLine, 'utf-8');
    } catch (error) {
      console.error(`Failed to write to log file: ${error}`);
    }
  }

  debug(message: string, extra?: Record<string, any>): void {
    this._log('DEBUG', message, extra);
  }

  info(message: string, extra?: Record<string, any>): void {
    this._log('INFO', message, extra);
  }

  warning(message: string, extra?: Record<string, any>): void {
    this._log('WARNING', message, extra);
  }

  error(message: string, extra?: Record<string, any>): void {
    this._log('ERROR', message, extra);
  }

  critical(message: string, extra?: Record<string, any>): void {
    this._log('CRITICAL', message, extra);
  }

  private _log(level: string, message: string, extra?: Record<string, any>): void {
    const logEntry = this.formatLogEntry(level, message, extra);
    this.writeLog(logEntry);
  }

  logFileOperation(
    operation: string,
    sourcePath: string,
    destinationPath?: string,
    success: boolean = true,
    errorMessage?: string,
  ): void {
    const logData: Record<string, any> = {
      operation,
      source_path: sourcePath,
      success,
    };

    if (destinationPath) {
      logData.destination_path = destinationPath;
    }

    if (errorMessage) {
      logData.error = errorMessage;
    }

    if (success) {
      this.info(`File operation completed: ${operation}`, logData);
    } else {
      this.error(`File operation failed: ${operation}`, logData);
    }
  }

  logTmdbRequest(
    requestType: string,
    query: string,
    success: boolean,
    resultCount?: number,
    tmdbId?: number,
    errorMessage?: string,
  ): void {
    const logData: Record<string, any> = {
      request_type: requestType,
      query,
      success,
    };

    if (resultCount !== undefined) {
      logData.result_count = resultCount;
    }

    if (tmdbId !== undefined) {
      logData.tmdb_id = tmdbId;
    }

    if (errorMessage) {
      logData.error = errorMessage;
    }

    if (success) {
      this.info(`TMDb request completed: ${requestType}`, logData);
    } else {
      this.error(`TMDb request failed: ${requestType}`, logData);
    }
  }

  logProcessingStep(
    step: string,
    filepath: string,
    contentType: string,
    success: boolean,
    details?: Record<string, any>,
  ): void {
    const logData: Record<string, any> = {
      step,
      filepath,
      content_type: contentType,
      success,
    };

    if (details) {
      Object.assign(logData, details);
    }

    if (success) {
      this.info(`Processing step completed: ${step}`, logData);
    } else {
      this.error(`Processing step failed: ${step}`, logData);
    }
  }
}

// Global logger instance
let globalLogger: PlexLogger | null = null;

export function setupLogging(
  logLevel: string = DEFAULT_LOG_LEVEL,
  logDir?: string,
  enableConsole: boolean = true,
): PlexLogger {
  globalLogger = new PlexLogger('plex-media-tool', logLevel, logDir, enableConsole);
  return globalLogger;
}

export function getLogger(): PlexLogger {
  if (!globalLogger) {
    globalLogger = setupLogging();
  }
  return globalLogger;
}

// Export convenience functions
export const debug = (message: string, extra?: Record<string, any>) =>
  getLogger().debug(message, extra);

export const info = (message: string, extra?: Record<string, any>) =>
  getLogger().info(message, extra);

export const warning = (message: string, extra?: Record<string, any>) =>
  getLogger().warning(message, extra);

export const error = (message: string, extra?: Record<string, any>) =>
  getLogger().error(message, extra);

export const critical = (message: string, extra?: Record<string, any>) =>
  getLogger().critical(message, extra);
