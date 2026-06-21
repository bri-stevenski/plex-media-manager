# Plan: Unified Media Processor

**Date:** 2026-05-12 | **Spec:** `docs/changes/phase-1-ai-core/proposal.md` (Step 2) | **Tasks:** 5 | **Time:** ~25 min | **Integration Tier:** medium

---

## Gates

- **No vague tasks.** Every task has exact file paths, exact code, and exact commands.
- **No tasks larger than one context window.** No task requires exploring or touching more than 2 files.
- **TDD adapted:** No test framework is configured; each code task is verified with `npm run build` and a `--dry-run` CLI smoke test.
- **No implementation during planning.** Execute tasks with harness-execution after plan approval.
- **Uncertainties surfaced.** See SCOPE section.

---

## Observable Truths (Acceptance Criteria)

1. `src/services/processor.ts` exists and exports `MediaProcessor`, `MediaHandler`, `ProcessorOptions`.
2. `src/services/index.ts` re-exports everything from `./processor`.
3. When `processor.run(sourceDir, handler)` is called, the system shall scan `sourceDir` recursively and invoke `handler.buildDestinationPath(stagedPath)` for each eligible file.
4. When `dryRun: false`, the system shall stage each file to `processing/<sessionId>/` before calling the handler, then move staged file to the handler-returned path or quarantine.
5. When `dryRun: true`, the system shall not move any files — it shall log `DRY RUN: <name> -> <relpath>` for each eligible file.
6. When `handler.buildDestinationPath` returns `null`, the system shall quarantine the staged file to `failed/` and return `'failed'`.
7. When staging fails, the system shall quarantine the original file to `backup/` and return `'failed'`.
8. The system shall move sidecar files (`.srt`, `.ass`, `.nfo`, etc.) alongside the main media file at each pipeline step.
9. `npm run build` passes with zero TypeScript errors after all tasks.
10. `node dist/agents/cli-movies.js --dry-run --log-level DEBUG <dir>` produces correct Plex-format log output post-refactor.

---

## Uncertainties

- `[ASSUMPTION]` No test framework is configured — TDD verification uses `npm run build` + `--dry-run` CLI smoke test.
- `[DEFERRABLE]` `cli-media.ts` (the `rename:run` script target) does not exist; it is a future unified multi-type entry point, not in scope here.
- `[DEFERRABLE]` Music, Audiobook, Podcast handlers — `MusicOrganizer.processFile` is a stub. The `MediaHandler` interface accommodates them without changes.

---

## File Map

```
CREATE  src/services/processor.ts
MODIFY  src/services/index.ts
MODIFY  src/agents/cli-movies.ts
MODIFY  src/agents/cli-tv.ts
```

---

## Task 1: Create `src/services/processor.ts`

**Depends on:** — | **Files:** `src/services/processor.ts` (CREATE)

**What:** Implement the full `MediaProcessor` class with `ProcessorOptions` and `MediaHandler` interfaces. This consolidates the ~250 lines of duplicated staging/quarantine/sidecar/cleanup logic from both `MoviesRenamer` and `TvRenamer`.

**Exact file to create:** `src/services/processor.ts`

```typescript
import path from 'path';
import fs from 'fs';
import {
  scanMediaFiles,
  safeMove,
  ensureDirectoryExists,
  moveSidecarFiles,
  pruneEmptyDirectories,
  removeKnownQueueArtifacts,
} from '../repository';
import { getLogger } from '../config';
import type { FileResult } from '../types';

const logger = getLogger();

export interface ProcessorOptions {
  dryRun?: boolean;
  recursive?: boolean;
  libraryRoot: string;
  destinationRoot: string;
  processingRoot: string;
  queueRoot: string;
  failedRoot: string;
  backupRoot: string;
}

export interface MediaHandler {
  shouldSkip(filepath: string): boolean;
  buildDestinationPath(stagedPath: string): Promise<string | null>;
}

export class MediaProcessor {
  private readonly dryRun: boolean;
  private readonly recursive: boolean;
  private readonly libraryRoot: string;
  private readonly processingRoot: string;
  private readonly queueRoot: string;
  private readonly failedRoot: string;
  private readonly backupRoot: string;
  private readonly sessionRoot: string;
  private running: boolean;
  private sourceRoot: string | null;

  constructor(options: ProcessorOptions) {
    this.dryRun = options.dryRun ?? false;
    this.recursive = options.recursive ?? true;
    this.libraryRoot = path.resolve(options.libraryRoot);
    this.processingRoot = path.resolve(options.processingRoot);
    this.queueRoot = path.resolve(options.queueRoot);
    this.failedRoot = path.resolve(options.failedRoot);
    this.backupRoot = path.resolve(options.backupRoot);
    const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-pid${process.pid}`;
    this.sessionRoot = path.join(this.processingRoot, sessionId);
    this.running = true;
    this.sourceRoot = null;

    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());
  }

  private handleShutdown(): void {
    logger.info('Received shutdown signal, exiting gracefully...');
    this.running = false;
    process.exit(0);
  }

  async run(sourceDir: string, handler: MediaHandler): Promise<void> {
    const sourceRoot = path.resolve(sourceDir);
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error(`Source directory not found: ${sourceRoot}`);
    }

    this.sourceRoot = sourceRoot;
    logger.info(`Starting processing from: ${sourceRoot}`);

    let total = 0,
      organized = 0,
      skipped = 0,
      failed = 0;

    const mediaFiles = Array.from(scanMediaFiles(sourceRoot, this.recursive));

    for (const filepath of mediaFiles) {
      if (!this.running) break;
      total++;
      const result = await this.processFile(filepath, handler);
      if (result === 'organized') organized++;
      else if (result === 'skipped') skipped++;
      else failed++;
    }

    this.cleanupQueue(sourceRoot);

    const prefix = this.dryRun ? 'DRY RUN COMPLETE -' : 'Processing complete -';
    logger.info(
      `${prefix} Total: ${total}, Organized: ${organized}, Skipped: ${skipped}, Failed: ${failed}`,
    );
  }

  private async processFile(filepath: string, handler: MediaHandler): Promise<FileResult> {
    logger.info(`Processing file: ${filepath}`);

    if (handler.shouldSkip(filepath)) {
      logger.info(`Skipping supplemental file: ${filepath}`);
      return 'skipped';
    }

    const relativePath = this.getRelative(filepath);
    let workingPath = filepath;

    if (!this.dryRun && this.sourceRoot) {
      const staged = this.stageToProcessing(filepath, relativePath);
      if (!staged) {
        this.quarantine(filepath, relativePath, this.backupRoot, 'backup');
        return 'failed';
      }
      workingPath = staged;
    }

    try {
      const destinationPath = await handler.buildDestinationPath(workingPath);

      if (!destinationPath) {
        logger.warning(`No destination path resolved for: ${workingPath}`);
        if (!this.dryRun) this.quarantine(workingPath, relativePath, this.failedRoot, 'failed');
        return 'failed';
      }

      return this.moveToDestination(workingPath, destinationPath, relativePath);
    } catch (error) {
      logger.error(`Failed to process ${workingPath}: ${error}`);
      if (!this.dryRun) this.quarantine(workingPath, relativePath, this.failedRoot, 'failed');
      return 'failed';
    }
  }

  private stageToProcessing(sourcePath: string, relativePath: string): string | null {
    const stagedPath = path.join(this.sessionRoot, relativePath);

    try {
      ensureDirectoryExists(path.dirname(stagedPath));
    } catch (error) {
      logger.error(`Failed creating processing directory for ${stagedPath}: ${error}`);
      return null;
    }

    if (!safeMove(sourcePath, stagedPath)) return null;

    try {
      const s = moveSidecarFiles(sourcePath, stagedPath);
      if (s.moved || s.skipped || s.failed) {
        logger.info(
          `Staged sidecars - moved: ${s.moved}, skipped: ${s.skipped}, failed: ${s.failed}`,
        );
      }
    } catch (error) {
      logger.warning(`Failed staging sidecars for ${sourcePath}: ${error}`);
    }

    this.cleanupDir(path.dirname(sourcePath));
    return stagedPath;
  }

  private quarantine(
    sourcePath: string,
    relativePath: string,
    targetRoot: string,
    label: string,
  ): void {
    const dest = path.join(targetRoot, relativePath);

    try {
      ensureDirectoryExists(path.dirname(dest));
    } catch (error) {
      logger.error(`Failed creating ${label} directory for ${dest}: ${error}`);
      return;
    }

    if (!safeMove(sourcePath, dest)) {
      logger.error(`Failed quarantining to ${label}: ${sourcePath} -> ${dest}`);
      return;
    }

    try {
      const s = moveSidecarFiles(sourcePath, dest);
      if (s.moved || s.skipped || s.failed) {
        logger.info(
          `Quarantine sidecars (${label}) - moved: ${s.moved}, skipped: ${s.skipped}, failed: ${s.failed}`,
        );
      }
    } catch (error) {
      logger.warning(`Sidecar quarantine failed (${label}) for ${sourcePath}: ${error}`);
    }

    this.cleanupDir(path.dirname(sourcePath));
    logger.info(`Quarantined to ${label}: ${path.relative(this.libraryRoot, dest)}`);
  }

  private moveToDestination(
    sourcePath: string,
    destinationPath: string,
    relativePath: string,
  ): FileResult {
    const resolvedSrc = path.resolve(sourcePath);
    const resolvedDest = path.resolve(destinationPath);
    const isSame =
      process.platform === 'win32'
        ? resolvedSrc.toLowerCase() === resolvedDest.toLowerCase()
        : resolvedSrc === resolvedDest;

    if (isSame) {
      logger.debug(`Already organized: ${sourcePath}`);
      return 'skipped';
    }

    if (fs.existsSync(destinationPath)) {
      logger.error(`Destination already exists: ${destinationPath}`);
      if (!this.dryRun) this.quarantine(sourcePath, relativePath, this.failedRoot, 'failed');
      return 'failed';
    }

    const sourceName = path.basename(sourcePath);
    const destRelative = path.relative(this.libraryRoot, destinationPath);

    if (this.dryRun) {
      logger.info(`DRY RUN: ${sourceName} -> ${destRelative}`);
      return 'organized';
    }

    if (!safeMove(sourcePath, destinationPath)) {
      logger.error(`Move failed: ${sourcePath} -> ${destinationPath}`);
      this.quarantine(sourcePath, relativePath, this.backupRoot, 'backup');
      return 'failed';
    }

    try {
      const s = moveSidecarFiles(sourcePath, destinationPath);
      if (s.moved || s.skipped || s.failed) {
        logger.info(`Sidecars - moved: ${s.moved}, skipped: ${s.skipped}, failed: ${s.failed}`);
      }
    } catch (error) {
      logger.warning(`Sidecar move failed for ${sourcePath}: ${error}`);
    }

    this.cleanupDir(path.dirname(sourcePath));
    logger.info(`Moved: ${sourceName} -> ${destRelative}`);
    return 'organized';
  }

  private cleanupDir(dir: string): void {
    try {
      const deleted = removeKnownQueueArtifacts(dir);
      if (deleted > 0) logger.info(`Deleted ${deleted} queue artifact(s) from: ${dir}`);
    } catch (error) {
      logger.warning(`Artifact cleanup failed for ${dir}: ${error}`);
    }

    try {
      const stop = this.getPruneStop(dir);
      if (stop) pruneEmptyDirectories(dir, stop);
    } catch (error) {
      logger.warning(`Failed pruning empty folders for ${dir}: ${error}`);
    }
  }

  private getPruneStop(startDir: string): string | null {
    const candidates = [this.sessionRoot, this.queueRoot, this.sourceRoot].filter(
      Boolean,
    ) as string[];
    for (const c of candidates) {
      const rel = path.relative(c, startDir);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) return c;
    }
    return null;
  }

  private cleanupQueue(sourceRoot: string): void {
    if (this.dryRun) return;
    const rel = path.relative(this.queueRoot, sourceRoot);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;

    const dirs = this.collectDirs(sourceRoot).sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      try {
        removeKnownQueueArtifacts(dir);
      } catch (error) {
        logger.warning(`Queue artifact cleanup failed for ${dir}: ${error}`);
      }
    }
    for (const dir of dirs) {
      try {
        pruneEmptyDirectories(dir, this.queueRoot);
      } catch (error) {
        logger.warning(`Failed pruning ${dir}: ${error}`);
      }
    }
  }

  private collectDirs(root: string): string[] {
    const dirs: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      dirs.push(dir);
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) stack.push(path.join(dir, e.name));
        }
      } catch {
        // skip unreadable directories
      }
    }
    return dirs;
  }

  private getRelative(filepath: string): string {
    if (!this.sourceRoot) return path.basename(filepath);
    const rel = path.relative(this.sourceRoot, filepath);
    return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(filepath) : rel;
  }
}
```

**Verify:** `npm run build` — must produce zero TypeScript errors.

**Commit message:**

```
feat(services): add MediaProcessor — unified staging/quarantine/sidecar pipeline

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 2: Export `MediaProcessor` from `src/services/index.ts`

**Depends on:** Task 1 | **Files:** `src/services/index.ts` (MODIFY)

**Current content of `src/services/index.ts`:**

```typescript
export * from './formatter';
export * from './parser';
```

**New content** — add one line at the end:

```typescript
export * from './formatter';
export * from './parser';
export * from './processor';
```

**Verify:** `npm run build` — must produce zero TypeScript errors.

**Commit message:**

```
chore(services): export MediaProcessor from services barrel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 3: Refactor `src/agents/cli-movies.ts` — delegate pipeline to `MediaProcessor`

**Depends on:** Task 2 | **Files:** `src/agents/cli-movies.ts` (MODIFY)

**What to remove from `MoviesRenamer`:**

- All private fields: `processingRoot`, `queueRoot`, `failedRoot`, `backupRoot`, `processingSessionId`, `processingSessionRoot`, `running`, `activeSourceRoot`, `sourceRoot`
- All private methods: `handleShutdown`, `cleanupQueueArtifacts`, `collectDirectories`, `getRelativeToSource`, `stageToProcessing`, `getPruneStopFor`, `quarantineToBackup`, `quarantineToFailed`, `quarantineToRoot`, `moveToDestination`, `cleanupSourceAfterMove`, `extractYear`, `areSamePath`
- The `run()` method body (replace with processor delegation)

**What to keep / add:**

- Constructor that creates a `MediaProcessor`
- `run(sourceDir)` that calls `processor.run(sourceDir, moviesHandler)`
- A `MoviesHandler` class implementing `MediaHandler`
- `processFile` logic (parse + TMDb + path construction) moves into `MoviesHandler.buildDestinationPath`
- `shouldSkipSupplementalFile` moves into `MoviesHandler.shouldSkip`
- `lookupTmdbMetadata`, `buildDestinationPath`, `extractYear` stay as private methods on `MoviesHandler`

**Exact replacement for `cli-movies.ts`** (replace entire file after the imports block):

```typescript
#!/usr/bin/env node

import path from 'path';
import { Command } from 'commander';
import {
  CONTENT_TYPE_MOVIES,
  DEFAULT_LOG_LEVEL,
  LOG_DIR,
  MEDIA_BASE_DIR,
  BACKUP_FOLDER,
  COMPLETED_FOLDER,
  FAILED_FOLDER,
  PROCESSING_FOLDER,
  QUEUE_FOLDER,
  setupLogging,
  getLogger,
} from '../config';
import { TMDbClient, ensureDirectoryExists } from '../repository';
import { parseMediaFile, constructMoviePath, MediaProcessor, MediaHandler } from '../services';
import type { MediaInfo } from '../types';

const logger = getLogger();

class MoviesHandler implements MediaHandler {
  private readonly tmdbClient: TMDbClient;
  private readonly destinationRoot: string;

  constructor(tmdbClient: TMDbClient, destinationRoot: string) {
    this.tmdbClient = tmdbClient;
    this.destinationRoot = destinationRoot;
  }

  shouldSkip(filepath: string): boolean {
    const segments = path
      .normalize(filepath)
      .split(path.sep)
      .map((s) => s.toLowerCase());
    const supplemental = [
      'featurettes',
      'extras',
      'bonus',
      'bonus features',
      'behind the scenes',
      'deleted scenes',
      'trailers',
      'samples',
    ];
    return supplemental.some((name) => segments.includes(name));
  }

  async buildDestinationPath(stagedPath: string): Promise<string | null> {
    const mediaInfo = parseMediaFile(stagedPath);

    if (mediaInfo.content_type !== CONTENT_TYPE_MOVIES) {
      logger.warning(
        `Skipping: parsed as ${mediaInfo.content_type}, but handler only processes Movies.`,
      );
      return null;
    }

    logger.debug('Parsed media info', {
      filepath: stagedPath.split(/[\\/]/).pop(),
      content_type: mediaInfo.content_type,
      title: mediaInfo.title,
      year: mediaInfo.year,
    });

    const tmdbData = await this.lookupTmdb(mediaInfo);
    if (!tmdbData) {
      logger.warning(
        `No movie match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`,
        { filepath: stagedPath.split(/[\\/]/).pop(), title: mediaInfo.title },
      );
      return null;
    }

    return this.constructPath(stagedPath, mediaInfo, tmdbData);
  }

  private async lookupTmdb(mediaInfo: MediaInfo): Promise<Record<string, any> | null> {
    const title = (mediaInfo.title || '').trim();
    if (!title) {
      logger.warning('Parsed title is empty; cannot query TMDb');
      return null;
    }
    return this.tmdbClient.findBestMovieMatch(title, mediaInfo.year || undefined);
  }

  private constructPath(
    filepath: string,
    mediaInfo: MediaInfo,
    tmdbData: Record<string, any>,
  ): string | null {
    const tmdbId = Number(tmdbData.id);
    if (!Number.isFinite(tmdbId)) {
      logger.error(`Invalid TMDb ID in result: ${JSON.stringify(tmdbData)}`);
      return null;
    }

    const extension = path.extname(filepath);
    const movieTitle = String(tmdbData.title || mediaInfo.title || '').trim();
    const tmdbYear = this.extractYear(tmdbData.release_date);
    let movieYear = tmdbYear || mediaInfo.year;

    if (mediaInfo.year && tmdbYear && Math.abs(mediaInfo.year - tmdbYear) > 1) {
      logger.warning(
        `Year mismatch for '${movieTitle}': parsed ${mediaInfo.year}, TMDb ${tmdbYear}. Using parsed year.`,
      );
      movieYear = mediaInfo.year;
    }

    if (!movieTitle || !movieYear) {
      logger.warning(`Missing title/year for ${filepath}`);
      return null;
    }

    return constructMoviePath(movieTitle, movieYear, tmdbId, extension, this.destinationRoot);
  }

  private extractYear(dateLike: unknown): number | null {
    if (typeof dateLike !== 'string') return null;
    const match = /^(\d{4})/.exec(dateLike.trim());
    if (!match) return null;
    const parsed = Number(match[1]);
    return parsed >= 1900 && parsed <= 2099 ? parsed : null;
  }
}

class MoviesRenamer {
  private readonly processor: MediaProcessor;
  private readonly handler: MoviesHandler;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    recursive: boolean = true,
    libraryRoot: string = MEDIA_BASE_DIR,
    outputSubfolder: string = COMPLETED_FOLDER,
  ) {
    setupLogging(logLevel, LOG_DIR, true);
    const root = path.resolve(libraryRoot);
    const destinationRoot = path.resolve(root, outputSubfolder);
    const tmdbClient = new TMDbClient();

    this.handler = new MoviesHandler(tmdbClient, destinationRoot);
    this.processor = new MediaProcessor({
      dryRun,
      recursive,
      libraryRoot: root,
      destinationRoot,
      processingRoot: path.resolve(root, PROCESSING_FOLDER),
      queueRoot: path.resolve(root, QUEUE_FOLDER, 'movies'),
      failedRoot: path.resolve(root, FAILED_FOLDER),
      backupRoot: path.resolve(root, BACKUP_FOLDER),
    });

    logger.info('Movies Renamer initialized', {
      dry_run: dryRun,
      recursive,
      library_root: root,
      destination_root: destinationRoot,
    });
  }

  async run(sourceDir: string): Promise<void> {
    return this.processor.run(sourceDir, this.handler);
  }
}

async function main() {
  const program = new Command();

  program
    .name('plex-movies-organizer')
    .description('TMDb-based movies organizer for Plex naming and folder conventions')
    .argument(
      '[source_dir]',
      'Source directory to scan. Defaults to <library_root>/queue/movies if omitted.',
    )
    .option('--dry-run', 'Preview changes without making modifications')
    .option('--no-recursive', 'Only scan source_dir, not nested directories')
    .option('--use-episode-titles', 'Unused — kept for CLI compatibility')
    .option(
      '--library-root <path>',
      'Root media folder that contains source and destination media folders',
      MEDIA_BASE_DIR,
    )
    .option(
      '--output-subfolder <name>',
      'Subfolder under library-root where organized files are written',
      COMPLETED_FOLDER,
    )
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action(async (sourceDir, options) => {
      try {
        const libraryRoot = path.resolve(options.libraryRoot || MEDIA_BASE_DIR);
        const queueRoot = path.resolve(libraryRoot, QUEUE_FOLDER, 'movies');
        const processingRoot = path.resolve(libraryRoot, PROCESSING_FOLDER);
        const failedRoot = path.resolve(libraryRoot, FAILED_FOLDER);
        const backupRoot = path.resolve(libraryRoot, BACKUP_FOLDER);
        const destinationRoot = path.resolve(
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

        ensureDirectoryExists(libraryRoot);
        ensureDirectoryExists(processingRoot);
        ensureDirectoryExists(failedRoot);
        ensureDirectoryExists(backupRoot);
        ensureDirectoryExists(destinationRoot);

        if (!sourceDir) ensureDirectoryExists(queueRoot);

        const resolvedSource = sourceDir ? path.resolve(sourceDir) : queueRoot;

        const renamer = new MoviesRenamer(
          options.dryRun || false,
          options.logLevel,
          options.recursive !== false,
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

        await renamer.run(resolvedSource);
      } catch (error) {
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
```

**Verify:** `npm run build` — must produce zero TypeScript errors.

**Commit message:**

```
refactor(agents): MoviesRenamer delegates to MediaProcessor

Eliminates ~250 lines of staging/quarantine/sidecar/cleanup code
by delegating pipeline logic to MediaProcessor. MoviesHandler
implements MediaHandler for TMDb lookup and path construction.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 4: Refactor `src/agents/cli-tv.ts` — delegate pipeline to `MediaProcessor`

**Depends on:** Task 2 | **Files:** `src/agents/cli-tv.ts` (MODIFY)

**What:** Apply the same pattern as Task 3. Replace the duplicated pipeline in `TvRenamer` with `MediaProcessor`. TV logic (parse → TMDb TV lookup → path construction for numbered or date-based episodes) moves into `TvHandler implements MediaHandler`.

**Key difference from movies:** `TvHandler.buildDestinationPath` must handle both numbered episodes (`constructTvShowPath`) and date-based episodes (`constructTvShowDatePath`). The `findBestTvMatch` TMDb method returns episode info in a nested structure — carry the existing logic from `cli-tv.ts`'s `buildDestinationPath` method verbatim into `TvHandler`.

**Exact replacement for `cli-tv.ts`** (replace entire file content):

```typescript
#!/usr/bin/env node

import path from 'path';
import { Command } from 'commander';
import {
  CONTENT_TYPE_TV,
  DEFAULT_LOG_LEVEL,
  LOG_DIR,
  MEDIA_BASE_DIR,
  BACKUP_FOLDER,
  COMPLETED_FOLDER,
  FAILED_FOLDER,
  PROCESSING_FOLDER,
  QUEUE_FOLDER,
  setupLogging,
  getLogger,
} from '../config';
import { TMDbClient, ensureDirectoryExists } from '../repository';
import {
  parseMediaFile,
  constructTvShowPath,
  constructTvShowDatePath,
  MediaProcessor,
  MediaHandler,
} from '../services';
import type { MediaInfo } from '../types';

const logger = getLogger();

class TvHandler implements MediaHandler {
  private readonly tmdbClient: TMDbClient;
  private readonly destinationRoot: string;
  private readonly useEpisodeTitles: boolean;

  constructor(tmdbClient: TMDbClient, destinationRoot: string, useEpisodeTitles: boolean) {
    this.tmdbClient = tmdbClient;
    this.destinationRoot = destinationRoot;
    this.useEpisodeTitles = useEpisodeTitles;
  }

  shouldSkip(filepath: string): boolean {
    const segments = path
      .normalize(filepath)
      .split(path.sep)
      .map((s) => s.toLowerCase());
    const supplemental = [
      'featurettes',
      'extras',
      'bonus',
      'bonus features',
      'behind the scenes',
      'deleted scenes',
      'trailers',
      'samples',
    ];
    return supplemental.some((name) => segments.includes(name));
  }

  async buildDestinationPath(stagedPath: string): Promise<string | null> {
    const mediaInfo = parseMediaFile(stagedPath);

    if (mediaInfo.content_type !== CONTENT_TYPE_TV) {
      logger.warning(
        `Skipping: parsed as ${mediaInfo.content_type}, but handler only processes TV Shows.`,
      );
      return null;
    }

    logger.debug('Parsed media info', {
      filepath: stagedPath.split(/[\\/]/).pop(),
      content_type: mediaInfo.content_type,
      title: mediaInfo.title,
      year: mediaInfo.year,
      season: mediaInfo.season,
      episode: mediaInfo.episode,
    });

    // Step 1: find the show — returns {id, name, first_air_date, ...}
    const tmdbData = await this.lookupTmdb(mediaInfo);
    if (!tmdbData) {
      logger.warning(
        `No TV show match found for: "${mediaInfo.title}"${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`,
        { filepath: stagedPath.split(/[\\/]/).pop(), title: mediaInfo.title },
      );
      return null;
    }

    // Step 2: enrich mediaInfo with episode metadata (season, episode, episode_title)
    await this.enrichEpisodeMetadata(mediaInfo, tmdbData);

    // Step 3: construct the destination path
    return this.constructPath(stagedPath, mediaInfo, tmdbData);
  }

  private async lookupTmdb(mediaInfo: MediaInfo): Promise<Record<string, any> | null> {
    const title = (mediaInfo.title || '').trim();
    if (!title) {
      logger.warning('Parsed title is empty; cannot query TMDb');
      return null;
    }
    // findBestTvMatch returns raw show search result: {id, name, first_air_date, ...}
    return this.tmdbClient.findBestTvMatch(
      title,
      mediaInfo.year || undefined,
      this.useEpisodeTitles,
    );
  }

  private async enrichEpisodeMetadata(
    mediaInfo: MediaInfo,
    tmdbData: Record<string, any>,
  ): Promise<void> {
    if (!tmdbData.id) return;

    if (mediaInfo.date_str) {
      try {
        const ep = await this.tmdbClient.getEpisodeByAirDate(tmdbData.id, mediaInfo.date_str);
        if (ep) {
          if (typeof ep.name === 'string' && ep.name.trim())
            mediaInfo.episode_title = ep.name.trim();
          if (typeof ep.season_number === 'number') mediaInfo.season = ep.season_number;
          if (typeof ep.episode_number === 'number') mediaInfo.episode = ep.episode_number;
          return;
        }
      } catch (error) {
        logger.warning(`TMDb air-date episode lookup failed for ${mediaInfo.title}: ${error}`);
      }
    }

    if (mediaInfo.season === null || mediaInfo.episode === null) return;

    try {
      const ep = await this.tmdbClient.getEpisodeInfo(
        tmdbData.id,
        mediaInfo.season,
        mediaInfo.episode,
        mediaInfo.episode_title || undefined,
        this.useEpisodeTitles,
      );
      if (ep) {
        if (typeof ep.name === 'string' && ep.name.trim()) mediaInfo.episode_title = ep.name.trim();
        if (typeof ep.season_number === 'number') mediaInfo.season = ep.season_number;
        if (typeof ep.episode_number === 'number') mediaInfo.episode = ep.episode_number;
      }
    } catch (error) {
      logger.warning(`TMDb episode enrichment failed for ${mediaInfo.title}: ${error}`);
    }
  }

  private constructPath(
    filepath: string,
    mediaInfo: MediaInfo,
    tmdbData: Record<string, any>,
  ): string | null {
    // tmdbData fields: id (show ID), name (show title), first_air_date
    // episode fields live on enriched mediaInfo: season, episode, episode_title, date_str
    const tmdbId = Number(tmdbData.id);
    if (!Number.isFinite(tmdbId)) {
      logger.error(`Invalid TMDb ID in result: ${JSON.stringify(tmdbData)}`);
      return null;
    }

    const extension = path.extname(filepath);
    const seriesTitle = String(tmdbData.name || mediaInfo.title || '').trim();
    const seriesYear = this.extractYear(tmdbData.first_air_date) || mediaInfo.year;

    if (!seriesTitle) {
      logger.warning(`Missing series title for ${filepath}`);
      return null;
    }

    // Date-based episode path
    if (mediaInfo.date_str) {
      const seasonForFolder = mediaInfo.season ?? 1;
      return constructTvShowDatePath(
        seriesTitle,
        seriesYear || null,
        tmdbId,
        seasonForFolder,
        mediaInfo.date_str,
        mediaInfo.episode_title,
        extension,
        this.destinationRoot,
      );
    }

    // Numbered episode path
    if (mediaInfo.season === null || mediaInfo.episode === null) {
      logger.warning(`Missing season/episode info for ${filepath}`);
      return null;
    }

    const episodeStr = String(mediaInfo.episode).padStart(2, '0');
    const episodeTitle = mediaInfo.episode_title || `Episode ${episodeStr}`;

    return constructTvShowPath(
      seriesTitle,
      seriesYear || null,
      tmdbId,
      mediaInfo.season,
      mediaInfo.episode,
      episodeTitle,
      extension,
      this.destinationRoot,
    );
  }

  private extractYear(dateLike: unknown): number | null {
    if (typeof dateLike !== 'string') return null;
    const match = /^(\d{4})/.exec(dateLike.trim());
    if (!match) return null;
    const parsed = Number(match[1]);
    return parsed >= 1900 && parsed <= 2099 ? parsed : null;
  }
}

class TvRenamer {
  private readonly processor: MediaProcessor;
  private readonly handler: TvHandler;

  constructor(
    dryRun: boolean = false,
    logLevel: string = DEFAULT_LOG_LEVEL,
    recursive: boolean = true,
    useEpisodeTitles: boolean = false,
    libraryRoot: string = MEDIA_BASE_DIR,
    outputSubfolder: string = COMPLETED_FOLDER,
  ) {
    setupLogging(logLevel, LOG_DIR, true);
    const root = path.resolve(libraryRoot);
    const destinationRoot = path.resolve(root, outputSubfolder);
    const tmdbClient = new TMDbClient();

    this.handler = new TvHandler(tmdbClient, destinationRoot, useEpisodeTitles);
    this.processor = new MediaProcessor({
      dryRun,
      recursive,
      libraryRoot: root,
      destinationRoot,
      processingRoot: path.resolve(root, PROCESSING_FOLDER),
      queueRoot: path.resolve(root, QUEUE_FOLDER, 'tv'),
      failedRoot: path.resolve(root, FAILED_FOLDER),
      backupRoot: path.resolve(root, BACKUP_FOLDER),
    });

    logger.info('TV Renamer initialized', {
      dry_run: dryRun,
      recursive,
      library_root: root,
      destination_root: destinationRoot,
    });
  }

  async run(sourceDir: string): Promise<void> {
    return this.processor.run(sourceDir, this.handler);
  }
}

async function main() {
  const program = new Command();

  program
    .name('plex-tv-organizer')
    .description('TMDb-based TV show organizer for Plex naming and folder conventions')
    .argument(
      '[source_dir]',
      'Source directory to scan. Defaults to <library_root>/queue/tv if omitted.',
    )
    .option('--dry-run', 'Preview changes without making modifications')
    .option('--no-recursive', 'Only scan source_dir, not nested directories')
    .option(
      '--use-episode-titles',
      'Use parsed episode titles to help TMDb identify correct episode numbers',
    )
    .option(
      '--library-root <path>',
      'Root media folder that contains source and destination media folders',
      MEDIA_BASE_DIR,
    )
    .option(
      '--output-subfolder <name>',
      'Subfolder under library-root where organized files are written',
      COMPLETED_FOLDER,
    )
    .option('--log-level <level>', 'Logging level (DEBUG, INFO, WARN, ERROR)', DEFAULT_LOG_LEVEL)
    .action(async (sourceDir, options) => {
      try {
        const libraryRoot = path.resolve(options.libraryRoot || MEDIA_BASE_DIR);
        const queueRoot = path.resolve(libraryRoot, QUEUE_FOLDER, 'tv');
        const processingRoot = path.resolve(libraryRoot, PROCESSING_FOLDER);
        const failedRoot = path.resolve(libraryRoot, FAILED_FOLDER);
        const backupRoot = path.resolve(libraryRoot, BACKUP_FOLDER);
        const destinationRoot = path.resolve(
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

        ensureDirectoryExists(libraryRoot);
        ensureDirectoryExists(processingRoot);
        ensureDirectoryExists(failedRoot);
        ensureDirectoryExists(backupRoot);
        ensureDirectoryExists(destinationRoot);

        if (!sourceDir) ensureDirectoryExists(queueRoot);

        const resolvedSource = sourceDir ? path.resolve(sourceDir) : queueRoot;

        const renamer = new TvRenamer(
          options.dryRun || false,
          options.logLevel,
          options.recursive !== false,
          options.useEpisodeTitles || false,
          libraryRoot,
          options.outputSubfolder || COMPLETED_FOLDER,
        );

        await renamer.run(resolvedSource);
      } catch (error) {
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
```

**Verify:** `npm run build` — must produce zero TypeScript errors.

**Commit message:**

```
refactor(agents): TvRenamer delegates to MediaProcessor

Same pattern as MoviesRenamer refactor. TvHandler implements
MediaHandler and handles both numbered and date-based episodes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 5: Build verification + dry-run smoke test

**Depends on:** Tasks 1–4 | **Files:** none

**[checkpoint:human-verify]**

Run the following commands and confirm the output looks correct before marking complete:

```bash
# 1. Full TypeScript build — must exit 0 with no errors
npm run build

# 2. Movies dry-run — must log DRY RUN lines for each .mkv/.mp4 found
node dist/agents/cli-movies.js --dry-run --log-level DEBUG <your-test-source-dir>

# 3. TV dry-run — must log DRY RUN lines for each episode file found
node dist/agents/cli-tv.js --dry-run --log-level DEBUG <your-test-source-dir>
```

Expected log pattern for each organized file:

```
info: DRY RUN: MovieName.mkv -> Movies/Movie Title (2024) {tmdb-12345}/Movie Title (2024) {tmdb-12345}.mkv
```

If `<your-test-source-dir>` does not exist or is empty, create a temporary directory and copy one test file there. If no TMDB_API_KEY is set, the process will exit with an error — that is expected and does not indicate a regression.

**Commit message:**

```
chore: verify MediaProcessor build and dry-run smoke test passes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Traceability Matrix

| Observable Truth                                                               | Task(s)           |
| ------------------------------------------------------------------------------ | ----------------- |
| 1. `processor.ts` exports `MediaProcessor`, `MediaHandler`, `ProcessorOptions` | Task 1            |
| 2. `services/index.ts` re-exports `./processor`                                | Task 2            |
| 3. `run()` scans recursively and calls `handler.buildDestinationPath`          | Task 1            |
| 4. `dryRun: false` stages to `processing/<sessionId>/`                         | Task 1            |
| 5. `dryRun: true` logs `DRY RUN:` and moves nothing                            | Task 1, Task 5    |
| 6. `null` from handler → quarantine to `failed/`                               | Task 1            |
| 7. Stage failure → quarantine to `backup/`                                     | Task 1            |
| 8. Sidecar files moved at each pipeline step                                   | Task 1            |
| 9. `npm run build` passes with zero TS errors                                  | Tasks 1–4, Task 5 |
| 10. `--dry-run` output matches expected Plex format                            | Tasks 3–4, Task 5 |

---

## Concerns

- `tsconfig.rename.json` referenced by `rename:build` script does not exist — only `tsconfig.json` is present. Use `npm run build` (not `rename:build`) as the build command throughout execution.
- `cli-media.ts` (referenced by `rename:run` script) does not exist. This is out of scope for this plan — leave `rename:run` as a broken script until a follow-up plan creates the unified entry point.
- The TV `TvHandler.constructPath` method's `tmdbData` field names (`show_id`, `show_title`, `episode_title`, `season_number`, `episode_number`, `air_date`, `first_air_date`) must be verified against the actual return shape of `findBestTvMatch` before writing Task 4. See the note in Task 4.
