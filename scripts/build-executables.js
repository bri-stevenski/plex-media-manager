#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Build standalone executables using Node.js SEA (Single Executable Applications).
 * Replaces the deprecated `pkg` tool. Requires Node.js >= 22.
 *
 * SEA builds are platform-specific: this script produces a binary for the
 * current OS/arch only. To produce binaries for other platforms, run this
 * script on those platforms (e.g. via CI matrix).
 *
 * Flow per tool:
 *   1. esbuild  — bundle dist + deps into one CJS file
 *   2. node --experimental-sea-config — generate the SEA blob
 *   3. copy the local node binary
 *   4. postject — inject the blob into the binary copy
 *   5. macOS only: re-sign with ad-hoc signature
 */

import { execSync, execFileSync } from 'child_process';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'fs';

const projectRoot = resolve(new URL('.', import.meta.url).pathname, '..');
const binDir = join(projectRoot, 'bin');
const buildDir = join(projectRoot, '.sea-build');

const platform = process.platform; // 'darwin' | 'win32' | 'linux'
const isWin = platform === 'win32';
const isMac = platform === 'darwin';

const tools = [
  {
    name: 'Media Renamer',
    entry: 'dist/agents/cli-media.js',
    outName: isWin ? 'plex-rename-media.exe' : 'plex-rename-media',
    outDir: 'plex-rename-media',
  },
  {
    name: 'Music Renamer',
    entry: 'dist/agents/cli-music.js',
    outName: isWin ? 'plex-rename-music.exe' : 'plex-rename-music',
    outDir: 'plex-rename-music',
  },
];

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: projectRoot, ...opts });
}

function runFile(bin, args, opts = {}) {
  execFileSync(bin, args, { stdio: 'inherit', cwd: projectRoot, ...opts });
}

console.log('Building standalone executables with Node.js SEA\n');
console.log(`Platform: ${platform} (current only — cross-compilation not supported)\n`);

// Ensure output dirs exist
mkdirSync(binDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

// Step 1: compile TypeScript
console.log('Compiling TypeScript...');
run('npm run build');

// Locate the node binary used by this process
const nodeBin = process.execPath;

for (const tool of tools) {
  console.log(`\nBuilding ${tool.name}...`);

  const toolBinDir = join(binDir, tool.outDir);
  mkdirSync(toolBinDir, { recursive: true });

  const bundleFile = join(buildDir, `${tool.outDir}-bundle.cjs`);
  const seaConfig = join(buildDir, `${tool.outDir}-sea-config.json`);
  const blobFile = join(buildDir, `${tool.outDir}.blob`);
  const outBin = join(toolBinDir, tool.outName);

  // 1. Bundle with esbuild
  console.log('  Bundling with esbuild...');
  run(
    `npx esbuild ${tool.entry} --bundle --platform=node --format=cjs` +
      ` --outfile=${bundleFile}` +
      ` --external:fsevents` // macOS-only optional dep — skip if absent
  );

  // 2. Write SEA config and generate blob
  console.log('  Generating SEA blob...');
  writeFileSync(
    seaConfig,
    JSON.stringify({
      main: bundleFile,
      output: blobFile,
      disableExperimentalSEAWarning: true,
    })
  );
  run(`node --experimental-sea-config ${seaConfig}`);

  // 3. Copy node binary
  console.log('  Copying node binary...');
  copyFileSync(nodeBin, outBin);

  // 4. macOS: strip existing signature before injection
  if (isMac) {
    console.log('  Removing existing signature (macOS)...');
    try {
      run(`codesign --remove-signature ${outBin}`, { stdio: 'pipe' });
    } catch {
      // may fail if binary is not signed — that's fine
    }
  }

  // 5. Inject blob with postject
  console.log('  Injecting blob with postject...');
  const postjectArgs = [
    outBin,
    'NODE_SEA_BLOB',
    blobFile,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  runFile('npx', ['postject', ...postjectArgs]);

  // 6. macOS: ad-hoc re-sign
  if (isMac) {
    console.log('  Re-signing binary (macOS)...');
    run(`codesign --sign - ${outBin}`);
  }

  console.log(`  Done: bin/${tool.outDir}/${tool.outName}`);
}

// Clean up intermediate build artefacts
rmSync(buildDir, { recursive: true, force: true });

console.log('\nBuild complete.');
console.log('  Media: bin/plex-rename-media/');
console.log('  Music: bin/plex-rename-music/');
