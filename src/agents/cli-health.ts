#!/usr/bin/env node
/**
 * plex-health — Scan the library for structural issues and report them.
 *
 * Usage:
 *   plex-health [options]
 *   plex-health --subtitles     # also flag files with no subtitle
 *   plex-health --notify        # push summary to Discord/Pushover
 *   plex-health --fix-junk      # delete junk files after confirming
 */

import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { setupLogging } from '../config/logger.js';
import { MEDIA_BASE_DIR, COMPLETED_FOLDER, DEFAULT_LOG_LEVEL } from '../config/env.js';
import { scanLibraryHealth, HealthIssue, HealthIssueKind } from '../services/library-health.js';
import { notify, isNotifierConfigured } from '../repository/notifier.js';

const EMOJI: Record<HealthIssueKind, string> = {
  'zero-byte': '⚠️ ',
  'broken-symlink': '🔗',
  'unmatched-file': '📁',
  'duplicate-quality': '♊ ',
  'no-subtitles': '🔇',
  'junk-file': '🗑️ ',
};

const LABEL: Record<HealthIssueKind, string> = {
  'zero-byte': 'Zero-byte file',
  'broken-symlink': 'Broken symlink',
  'unmatched-file': 'Unmatched file',
  'duplicate-quality': 'Duplicate quality',
  'no-subtitles': 'No subtitles',
  'junk-file': 'Junk file',
};

function groupByKind(issues: HealthIssue[]): Map<HealthIssueKind, HealthIssue[]> {
  const map = new Map<HealthIssueKind, HealthIssue[]>();
  for (const issue of issues) {
    if (!map.has(issue.kind)) map.set(issue.kind, []);
    map.get(issue.kind)!.push(issue);
  }
  return map;
}

program
  .name('plex-health')
  .description('Scan the media library for structural issues')
  .option('--library-root <path>', 'Root of the media library', MEDIA_BASE_DIR)
  .option('--output-subfolder <name>', 'Completed folder name', COMPLETED_FOLDER)
  .option('--subtitles', 'Flag video files that have no subtitle file alongside', false)
  .option('--notify', 'Send summary to configured notification channels', false)
  .option('--fix-junk', 'Delete detected junk files (NFO, TXT, stray images)', false)
  .option('--log-level <level>', 'Log level', DEFAULT_LOG_LEVEL)
  .action(async (options) => {
    const logger = setupLogging(options.logLevel.toUpperCase());
    const libraryDir = path.join(path.resolve(options.libraryRoot), options.outputSubfolder);

    if (!fs.existsSync(libraryDir)) {
      console.error(`Library directory not found: ${libraryDir}`);
      process.exit(1);
    }

    console.log(`\nScanning ${libraryDir} …\n`);
    const report = await scanLibraryHealth(libraryDir, options.subtitles);

    if (report.issues.length === 0) {
      console.log('✅ Library is healthy — no issues found.\n');
    } else {
      const grouped = groupByKind(report.issues);

      for (const [kind, issues] of grouped) {
        console.log(`${EMOJI[kind]} ${LABEL[kind]} (${issues.length})`);
        for (const issue of issues) {
          const rel = path.relative(libraryDir, issue.path);
          const detail = issue.detail ? `  — ${issue.detail}` : '';
          console.log(`     ${rel}${detail}`);
        }
        console.log();
      }

      // Summary line
      const counts = Object.entries(report.summary)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      console.log(`Scanned ${report.scannedFiles} files — ${report.issues.length} issues: ${counts}\n`);
    }

    // Auto-delete junk files if requested
    if (options.fixJunk && report.summary['junk-file'] > 0) {
      const junkFiles = report.issues.filter((i) => i.kind === 'junk-file');
      console.log(`Deleting ${junkFiles.length} junk file(s)…`);
      for (const junk of junkFiles) {
        try {
          fs.unlinkSync(junk.path);
          console.log(`  Deleted: ${junk.path}`);
        } catch (err: any) {
          console.error(`  Failed to delete ${junk.path}: ${err.message}`);
        }
      }
      console.log();
    }

    // Notifications
    if (options.notify) {
      if (!isNotifierConfigured()) {
        logger.warning('--notify passed but no notification channels configured');
      } else if (report.issues.length > 0) {
        const lines = Object.entries(report.summary)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${EMOJI[k as HealthIssueKind]} ${n} ${k}`)
          .join('\n');
        await notify(
          `Library health: ${report.issues.length} issue(s) found`,
          `Scanned ${report.scannedFiles} files\n\n${lines}`,
        );
        logger.info('Health report sent to notification channels');
      } else {
        await notify('Library health check passed', `Scanned ${report.scannedFiles} files — all clear.`);
      }
    }
  });

program.parse(process.argv);
