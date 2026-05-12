#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Build standalone executables using caxa.
 * caxa bundles the project directory + a Node.js binary into a self-extracting
 * binary — no manual blob injection or code-signing steps required.
 *
 * Cross-compilation is not supported: run this script on each target platform
 * (e.g. via CI matrix) to produce platform-specific binaries.
 */

import caxa from 'caxa';
import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const isWin = process.platform === 'win32';

const tools = [
  {
    name: 'Media Renamer',
    entry: 'dist/agents/cli-media.js',
    outDir: 'plex-rename-media',
    outName: isWin ? 'plex-rename-media.exe' : 'plex-rename-media',
  },
  {
    name: 'Music Renamer',
    entry: 'dist/agents/cli-music.js',
    outDir: 'plex-rename-music',
    outName: isWin ? 'plex-rename-music.exe' : 'plex-rename-music',
  },
];

// Directories that don't belong in the shipped binary
const exclude = [
  '.git',
  '.harness',
  '.claude',
  '.claude-plugin',
  'bin',
  'src',
  'docs',
  'scripts',
  '*.ts',
];

console.log('Building standalone executables with caxa\n');
console.log(`Platform: ${process.platform} (cross-compilation not supported)\n`);

// Compile TypeScript first
console.log('Compiling TypeScript...');
execSync('npm run build', { stdio: 'inherit', cwd: projectRoot });
console.log();

for (const tool of tools) {
  console.log(`Building ${tool.name}...`);

  const toolBinDir = join(projectRoot, 'bin', tool.outDir);
  mkdirSync(toolBinDir, { recursive: true });

  await caxa({
    input: projectRoot,
    output: join(toolBinDir, tool.outName),
    // {{caxa}} is replaced at runtime with the extraction directory.
    // caxa places the bundled node binary at node_modules/.bin/node.
    command: ['{{caxa}}/node_modules/.bin/node', `{{caxa}}/${tool.entry}`],
    exclude,
  });

  console.log(`  Done: bin/${tool.outDir}/${tool.outName}\n`);
}

console.log('Build complete.');
console.log('  Media: bin/plex-rename-media/');
console.log('  Music: bin/plex-rename-music/');
