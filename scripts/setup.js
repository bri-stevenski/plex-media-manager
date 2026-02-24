/* eslint-disable @typescript-eslint/no-require-imports, no-console */
'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'Use pinned Node version',
    command: 'npm run node:use',
  },
  {
    name: 'Clean build output, dependencies, and logs',
    command: 'npm run clean:all',
  },
  {
    name: 'Install dependencies',
    command: 'npm install',
  },
  {
    name: 'Apply style fixes',
    command: 'npm run style:fix',
  },
  {
    name: 'Run type checks',
    command: 'npm run type-check',
  },
  {
    name: 'Build renamer CLI',
    command: 'npm run build:all',
  },
];

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(results) {
  console.log('\nSetup summary');
  console.log('-------------');

  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.name} (${formatDuration(result.durationMs)})`);
  }
}

function printPlan() {
  console.log('\nSetup plan');
  console.log('----------');
  for (const [index, step] of steps.entries()) {
    console.log(`${index + 1}. ${step.name}`);
    console.log(`   ${step.command}`);
  }
}

function checkCommand(command) {
  return spawnSync(command, {
    shell: true,
    encoding: 'utf8',
  });
}

function runChecks() {
  const checks = [];
  const nvmrcPath = resolve(process.cwd(), '.nvmrc');
  const nvmrcExists = existsSync(nvmrcPath);
  const nvmrcValue = nvmrcExists ? readFileSync(nvmrcPath, 'utf8').trim() : '';

  checks.push({
    name: '.nvmrc exists',
    ok: nvmrcExists,
    detail: nvmrcExists ? nvmrcPath : 'missing',
  });
  checks.push({
    name: '.nvmrc has version value',
    ok: nvmrcValue.length > 0,
    detail: nvmrcValue || 'empty',
  });

  const npmCheck = checkCommand('npm -v');
  checks.push({
    name: 'npm command available',
    ok: npmCheck.status === 0,
    detail: npmCheck.status === 0 ? (npmCheck.stdout || '').trim() : (npmCheck.stderr || '').trim(),
  });

  const nvmCheck = checkCommand('nvm version');
  checks.push({
    name: 'nvm command available',
    ok: nvmCheck.status === 0,
    detail: nvmCheck.status === 0 ? (nvmCheck.stdout || '').trim() : (nvmCheck.stderr || '').trim(),
  });

  console.log('\nPreflight checks');
  console.log('---------------');
  for (const check of checks) {
    const status = check.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${check.name} - ${check.detail}`);
  }

  return checks.every((check) => check.ok);
}

function runStep(stepIndex, step) {
  const stepLabel = `[${stepIndex + 1}/${steps.length}]`;
  console.log(`\n${stepLabel} ${step.name}`);
  console.log(`$ ${step.command}\n`);

  const startMs = Date.now();
  const result = spawnSync(step.command, {
    shell: true,
    stdio: 'inherit',
  });
  const durationMs = Date.now() - startMs;

  return {
    name: step.name,
    command: step.command,
    durationMs,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
  };
}

function main() {
  const checkOnly = hasFlag('--check');
  if (checkOnly) {
    console.log('Running setup preflight checks...\n');
    printPlan();
    const ok = runChecks();
    if (ok) {
      console.log('\nEnvironment looks good. Safe to run: npm run setup');
      return;
    }

    console.error('\nPreflight checks failed. Fix the issues above before running setup.');
    process.exit(1);
  }

  console.log('Running project setup...\n');
  const results = [];

  for (let index = 0; index < steps.length; index += 1) {
    const result = runStep(index, steps[index]);
    results.push(result);

    if (!result.ok) {
      printSummary(results);
      console.error(
        `\nSetup failed at step ${index + 1}: "${result.name}" (exit code ${result.exitCode}).`,
      );
      process.exit(result.exitCode);
    }
  }

  printSummary(results);
  console.log('\nEnvironment looks good. Safe to run project commands.');
  console.log('Try: npm run rename:dry-run');
}

main();
