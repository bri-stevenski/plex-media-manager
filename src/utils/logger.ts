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

import fs from 'fs';
import path from 'path';
import winston from 'winston';
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
  private winstonLogger: winston.Logger;
  private logLevel: string;
  private name: string;

  constructor(
    name: string = 'plex-media-tool',
    logLevel: string = DEFAULT_LOG_LEVEL,
    logDir?: string,
    enableConsole: boolean = true,
  ) {
    this.name = name;
    this.logLevel = logLevel.toUpperCase();
    const actualLogDir = logDir || LOG_DIR;

    // Create log directory if it doesn't exist
    if (!fs.existsSync(actualLogDir)) {
      fs.mkdirSync(actualLogDir, { recursive: true });
    }

    // Generate timestamped log filename
    const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
    const logFile = path.join(actualLogDir, `${name}_${timestamp}.log`);

    // Create custom format for console with colors
    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 0) : '';
        return `${timestamp} ${level}: ${message}${metaStr ? ' ' + metaStr : ''}`;
      }),
    );

    // Create custom format for file (JSON)
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, ...meta }: any) => {
        const entry: LogEntry = {
          timestamp: String(timestamp),
          level: String(level),
          logger: this.name,
          message: String(message),
          module: 'plex-media-tool',
          ...meta,
        };
        return JSON.stringify(entry);
      }),
    );

    const transports: winston.transport[] = [
      new winston.transports.File({
        filename: logFile,
        format: fileFormat,
        level: this.logLevel.toLowerCase(),
      }),
    ];

    if (enableConsole) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
          level: this.logLevel.toLowerCase(),
        }),
      );
    }

    this.winstonLogger = winston.createLogger({
      level: this.logLevel.toLowerCase(),
      transports,
      exitOnError: false,
    });
  }

  debug(message: string, extra?: Record<string, any>): void {
    this.winstonLogger.debug(message, extra);
  }

  info(message: string, extra?: Record<string, any>): void {
    this.winstonLogger.info(message, extra);
  }

  warning(message: string, extra?: Record<string, any>): void {
    this.winstonLogger.warn(message, extra);
  }

  error(message: string, extra?: Record<string, any>): void {
    this.winstonLogger.error(message, extra);
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
