/* eslint-disable @typescript-eslint/no-require-imports, no-console */
'use strict';

/**
 * Writes dist/package.json with { "type": "commonjs" } as a postbuild step.
 *
 * The root package.json is "type": "module" (required so the .harness/hooks/*.js
 * ESM hooks load), but tsconfig emits CommonJS to dist/. Without a dist-scoped
 * override, Node treats the compiled dist/**\/*.js as ESM and throws
 * "exports is not defined in ES module scope" the moment any entry point runs.
 * This file scopes dist/ back to CommonJS so the built CLI actually starts.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);
console.log('postbuild: wrote dist/package.json ({ "type": "commonjs" })');
