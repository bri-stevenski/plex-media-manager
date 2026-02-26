/* eslint-disable @typescript-eslint/no-require-imports, no-console */
'use strict';

const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { spawnSync } = require('child_process');

function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/, '');
}

function getDesiredNodeVersion() {
  const nvmrcPath = resolve(process.cwd(), '.nvmrc');
  if (!existsSync(nvmrcPath)) {
    console.error(`Missing .nvmrc at: ${nvmrcPath}`);
    process.exit(1);
  }

  const version = normalizeVersion(readFileSync(nvmrcPath, 'utf8'));
  if (!version) {
    console.error(`.nvmrc is empty: ${nvmrcPath}`);
    process.exit(1);
  }

  return version;
}

function getCurrentNodeVersion() {
  return normalizeVersion(process.version);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    return { ok: false, status: 1, error: result.error };
  }

  return { ok: result.status === 0, status: result.status ?? 1 };
}

function getCommandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout || '').trim();
}

function main() {
  const desired = getDesiredNodeVersion();
  const current = getCurrentNodeVersion();

  if (current === desired) {
    console.log(`Node ${process.version} already matches .nvmrc (${desired}).`);
    return;
  }

  console.log(`Switching Node from ${process.version} -> v${desired} (via nvm)...`);

  const nvmVersion = getCommandOutput('nvm', ['version']);
  if (!nvmVersion) {
    console.error('nvm is not available on PATH.');
    console.error(`Install a Node version manager and switch to v${desired}, then re-run setup.`);
    console.error('If you use nvm-windows, run: nvm install <version> && nvm use <version>');
    process.exit(1);
  }

  console.log(`nvm detected (${nvmVersion}).`);

  const install = runCommand('nvm', ['install', desired]);
  if (!install.ok) {
    process.exit(install.status);
  }

  const use = runCommand('nvm', ['use', desired]);
  if (!use.ok) {
    process.exit(use.status);
  }

  const newNode = normalizeVersion(getCommandOutput('node', ['-v']));
  if (newNode !== desired) {
    console.error(`nvm reported success, but \`node -v\` is now v${newNode || 'unknown'}.`);
    console.error(`Expected: v${desired}`);
    process.exit(1);
  }

  const newNpm = getCommandOutput('npm', ['-v']);
  console.log(`Now using Node v${newNode} (npm ${newNpm || 'unknown'}).`);
}

main();
