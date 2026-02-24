#!/usr/bin/env node

/**
 * Build standalone executables using pkg
 * Creates pre-compiled binaries for macOS, Windows, and Linux
 */

import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const projectRoot = resolve(__dirname, '..');
const binDir = join(projectRoot, 'bin');

console.log('🔨 Building standalone executables with pkg...\n');

// Ensure bin directory exists
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

const targets = [
  {
    name: 'macOS (Intel)',
    target: 'node25-macos-x64',
  },
  {
    name: 'macOS (Apple Silicon)',
    target: 'node25-macos-arm64',
  },
  {
    name: 'Windows (x64)',
    target: 'node25-windows-x64',
  },
  {
    name: 'Linux (x64)',
    target: 'node25-linux-x64',
  },
];

const tools = [
  {
    name: 'Media Renamer',
    entry: 'dist/rename-media-files.js',
    outName: 'plex-rename-media',
  },
  {
    name: 'Music Renamer',
    entry: 'dist/rename-music-files.js',
    outName: 'plex-rename-music',
  },
];

try {
  // Build TypeScript first
  console.log('📦 Compiling TypeScript...\n');
  execSync('npm run rename:build', { stdio: 'inherit', cwd: projectRoot });
  execSync('npm run music:build', { stdio: 'inherit', cwd: projectRoot });

  // Build for each tool
  for (const tool of tools) {
    console.log(`\n🔧 Building ${tool.name}...\n`);

    // Create output directory for this tool
    const toolBinDir = join(binDir, tool.outName);
    if (!existsSync(toolBinDir)) {
      mkdirSync(toolBinDir, { recursive: true });
    }

    // Build for each target platform
    for (const target of targets) {
      console.log(`  📍 Building for ${target.name}...`);
      try {
        const outName =
          target.target.includes('windows') && !tool.outName.endsWith('.exe')
            ? `${tool.outName}.exe`
            : tool.outName;

        execSync(
          `npx pkg ${tool.entry} --compress Brotli --target ${target.target} --output ${join(toolBinDir, outName)}`,
          {
            stdio: 'pipe',
            cwd: projectRoot,
          },
        );
        console.log(`     ✅ Built: bin/${tool.outName}/${outName}`);
      } catch (error) {
        console.error(`     ❌ Failed to build for ${target.name}`);
        process.exit(1);
      }
    }
  }

  console.log('\n✨ Build complete!\n');
  console.log('📂 Executables location:');
  console.log(`   Media:  bin/plex-rename-media/`);
  console.log(`   Music:  bin/plex-rename-music/\n`);
  console.log('💾 Compressed binaries are ready for distribution.\n');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
