/* eslint-disable @typescript-eslint/no-require-imports, no-console */
'use strict';

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targetMap = {
  build: ['dist'],
  deps: ['node_modules'],
  logs: ['.logs'],
  all: ['dist', 'node_modules', '.logs'],
};

function usage() {
  console.error('Usage: node scripts/clean.js <build|deps|logs|all>');
}

function cleanTarget(relativePath) {
  const absolutePath = resolve(process.cwd(), relativePath);
  rmSync(absolutePath, { recursive: true, force: true });
  console.log(`Removed: ${relativePath}`);
}

function main() {
  const target = process.argv[2];
  if (!target || !Object.prototype.hasOwnProperty.call(targetMap, target)) {
    usage();
    process.exit(1);
  }

  for (const relativePath of targetMap[target]) {
    cleanTarget(relativePath);
  }
}

main();
