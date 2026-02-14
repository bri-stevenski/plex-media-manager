/**
 * Video transcoding module for media file conversion.
 *
 * This module provides functions for transcoding video files to formats
 * compatible with Plex and various devices, especially Apple TVs.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { TRANSCODE_SETTINGS } from './constants';
import { getLogger } from './logger';

const logger = getLogger();
const _execPromise = promisify(exec);

// Global set to track all active subprocesses
const activeProcesses = new Set<any>();

function registerProcess(process: any): void {
  activeProcesses.add(process);
}

function unregisterProcess(process: any): void {
  activeProcesses.delete(process);
}

export function cleanupAllProcesses(): void {
  logger.info(`Cleaning up ${activeProcesses.size} active processes...`);
  for (const process of activeProcesses) {
    try {
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    } catch (error) {
      logger.error(`Error killing process: ${error}`);
    }
  }
  activeProcesses.clear();
}

// Handle process cleanup on exit
process.on('exit', cleanupAllProcesses);
process.on('SIGINT', () => {
  cleanupAllProcesses();
  process.exit(1);
});
process.on('SIGTERM', () => {
  cleanupAllProcesses();
  process.exit(1);
});

export class TranscodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscodingError';
  }
}

export class VideoInfo {
  filepath: string;
  duration: number | null = null;
  size: number = 0;
  videoCodec: string | null = null;
  audioCodec: string | null = null;
  audioChannels: number | null = null;
  width: number | null = null;
  height: number | null = null;
  bitrate: number | null = null;
  isAlreadyCompatible: boolean = false;

  constructor(filepath: string) {
    this.filepath = filepath;
    this.probeSync();
  }

  private probeSync(): void {
    try {
      // Use ffprobe to get video information
      const { execSync } = require('child_process');
      const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${this.filepath}"`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      const probe = JSON.parse(output);

      this.parseProbeData(probe);
    } catch (error) {
      logger.error(`Failed to probe video file ${this.filepath}: ${error}`);
      throw new TranscodingError(`Failed to probe video file: ${error}`);
    }
  }

  private parseProbeData(probe: Record<string, any>): void {
    const formatInfo = probe.format || {};
    this.duration = parseFloat(formatInfo.duration) || null;
    this.size = parseInt(formatInfo.size) || 0;
    this.bitrate = parseInt(formatInfo.bit_rate) || null;

    const streams = probe.streams || [];
    for (const stream of streams) {
      if (stream.codec_type === 'video') {
        this.videoCodec = stream.codec_name;
        this.width = parseInt(stream.width) || null;
        this.height = parseInt(stream.height) || null;
      } else if (stream.codec_type === 'audio') {
        this.audioCodec = stream.codec_name;
        this.audioChannels = parseInt(stream.channels) || null;
      }
    }

    this.checkCompatibility();
  }

  private checkCompatibility(): void {
    const containerCompatible = path.extname(this.filepath).toLowerCase() === '.mp4';
    const videoCompatible = ['h264', 'avc1', 'avc'].includes(this.videoCodec || '');
    const audioCompatible =
      ['aac', 'mp3'].includes(this.audioCodec || '') &&
      (this.audioChannels === null || this.audioChannels <= 2);

    this.isAlreadyCompatible = containerCompatible && videoCompatible && audioCompatible;
  }
}

export function needsTranscoding(videoInfo: VideoInfo): boolean {
  return !videoInfo.isAlreadyCompatible;
}

export function estimateTranscodingTime(videoInfo: VideoInfo): number {
  if (!videoInfo.duration) {
    return 0;
  }
  // Rough estimate: transcoding takes about 1.5x real-time
  return videoInfo.duration * 1.5;
}

export function getTranscodeOutputPath(inputPath: string): string {
  return inputPath.replace(/\.[^.]+$/, '.mp4');
}

export async function transcodeVideo(
  inputPath: string,
  outputPath: string,
  settings?: Record<string, any>,
  progressCallback?: (time: string) => void,
): Promise<boolean> {
  if (!settings) {
    settings = TRANSCODE_SETTINGS;
  }

  return new Promise((resolve) => {
    const cmd = [
      'ffmpeg',
      '-i',
      inputPath,
      '-vf',
      "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
      '-c:v',
      settings.video_codec,
      '-preset',
      settings.preset,
      '-crf',
      String(settings.crf),
      '-c:a',
      settings.audio_codec,
      '-b:a',
      settings.audio_bitrate,
      '-ac',
      String(settings.max_audio_channels),
      '-y',
      outputPath,
    ];

    logger.info(`Starting transcoding: ${cmd.join(' ')}`);

    const process = spawn('ffmpeg', cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    registerProcess(process);

    process.stdout!.on('data', (data) => {
      if (progressCallback && data.toString().includes('time=')) {
        try {
          const match = /time=([^ ]+)/.exec(data.toString());
          if (match) {
            progressCallback(match[1]);
          }
        } catch {
          // Ignore parsing errors
        }
      }
    });

    process.on('close', (code) => {
      unregisterProcess(process);

      if (code === 0) {
        logger.info(`Transcoding completed: ${outputPath}`);
        resolve(true);
      } else {
        logger.error(`Transcoding failed with return code ${code}`);
        resolve(false);
      }
    });

    process.on('error', (error) => {
      logger.error(`Transcoding error: ${error}`);
      resolve(false);
    });
  });
}

export async function validateTranscodedFile(
  originalPath: string,
  transcodedPath: string,
): Promise<boolean> {
  try {
    if (!fs.existsSync(transcodedPath)) {
      return false;
    }

    const originalSize = fs.statSync(originalPath).size;
    const transcodedSize = fs.statSync(transcodedPath).size;

    // Transcoded file should be at least 10% of original
    if (transcodedSize < originalSize * 0.1) {
      return false;
    }

    // Try to probe the transcoded file
    const transcodedInfo = new VideoInfo(transcodedPath);

    // Check that it has video and audio streams
    return transcodedInfo.videoCodec !== null && transcodedInfo.audioCodec !== null;
  } catch (error) {
    logger.error(`Failed to validate transcoded file: ${error}`);
    return false;
  }
}

export function cleanupTranscodingArtifacts(filepath: string): void {
  const tempPatterns = [filepath + '.tmp', filepath.replace(/\.[^.]+$/, '') + '.tmp'];

  for (const tempFile of tempPatterns) {
    if (fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
        logger.debug(`Cleaned up temporary file: ${tempFile}`);
      } catch (error) {
        logger.warning(`Failed to clean up temporary file ${tempFile}: ${error}`);
      }
    }
  }
}
