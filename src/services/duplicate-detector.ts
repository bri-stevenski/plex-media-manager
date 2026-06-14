import fs from 'fs';
import path from 'path';
import { scanMediaFiles } from '../repository/index.js';
import { getLogger } from '../config/logger.js';

export type QualityTier = '2160p' | '1080p' | '720p' | '480p' | 'unknown';

const QUALITY_ORDER: QualityTier[] = ['2160p', '1080p', '720p', '480p', 'unknown'];

const QUALITY_PATTERNS: [RegExp, QualityTier][] = [
  [/\b(2160p|4k|uhd)\b/i, '2160p'],
  [/\b1080p\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b480p\b/i, '480p'],
];

export function detectQuality(filePath: string): QualityTier {
  const name = path.basename(filePath);
  for (const [pattern, tier] of QUALITY_PATTERNS) {
    if (pattern.test(name)) return tier;
  }
  return 'unknown';
}

export function qualityRank(tier: QualityTier): number {
  return QUALITY_ORDER.length - QUALITY_ORDER.indexOf(tier);
}

export type DuplicateAction = 'skip' | 'replace' | 'add';

export interface DuplicateCheckResult {
  action: DuplicateAction;
  /** Existing file that was found, if any. */
  existingPath?: string;
  existingQuality?: QualityTier;
  incomingQuality: QualityTier;
  reason: string;
}

/**
 * Scan destinationDir for files that share the same base name (minus quality
 * tags) as incomingPath and decide whether to skip, replace, or add alongside.
 */
export function checkForDuplicate(
  incomingPath: string,
  destinationDir: string,
  upgradePolicy: 'always-upgrade' | 'never-upgrade' | 'ask' = 'always-upgrade',
): DuplicateCheckResult {
  const incomingQuality = detectQuality(incomingPath);

  if (!fs.existsSync(destinationDir)) {
    return { action: 'add', incomingQuality, reason: 'Destination directory does not exist yet.' };
  }

  const incomingBase = normalizeBaseName(path.basename(incomingPath));

  for (const existing of scanMediaFiles(destinationDir)) {
    const existingBase = normalizeBaseName(path.basename(existing));
    if (existingBase !== incomingBase) continue;

    const existingQuality = detectQuality(existing);

    if (upgradePolicy === 'never-upgrade') {
      getLogger().info('Duplicate found, skipping (never-upgrade policy)', {
        existing,
        incomingPath,
      });
      return {
        action: 'skip',
        existingPath: existing,
        existingQuality,
        incomingQuality,
        reason: 'Duplicate exists and never-upgrade policy is set.',
      };
    }

    if (qualityRank(incomingQuality) > qualityRank(existingQuality)) {
      getLogger().info('Upgrade detected — will replace lower quality file', {
        existing,
        existingQuality,
        incomingQuality,
      });
      return {
        action: 'replace',
        existingPath: existing,
        existingQuality,
        incomingQuality,
        reason: `Incoming ${incomingQuality} upgrades existing ${existingQuality}.`,
      };
    }

    getLogger().info('Duplicate found at equal or better quality, skipping', {
      existing,
      existingQuality,
      incomingQuality,
    });
    return {
      action: 'skip',
      existingPath: existing,
      existingQuality,
      incomingQuality,
      reason: `Already have ${existingQuality}, incoming is ${incomingQuality}.`,
    };
  }

  return { action: 'add', incomingQuality, reason: 'No duplicate found.' };
}

function normalizeBaseName(filename: string): string {
  const ext = path.extname(filename);
  let stem = path.basename(filename, ext).toLowerCase();
  // Strip quality/codec/source tags so "Movie.2023.1080p.mkv" ≈ "Movie.2023.2160p.mkv"
  stem = stem.replace(
    /\b(480p|720p|1080p|2160p|4k|uhd|hdr\d*\+?|dv|web[-.]?dl|webrip|bluray|remux|x26[45]|h\.?26[45]|hevc|avc|aac|dts|ac3|ddp?\d?\.?\d?|atmos|truehd|flac|proper|repack|internal|extended|theatrical|directors\.cut)\b/gi,
    '',
  );
  // Collapse extra separators
  stem = stem.replace(/[\s._-]+/g, '.');
  return stem.replace(/^\.+|\.+$/g, '');
}
